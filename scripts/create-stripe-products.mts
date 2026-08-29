import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Stripe from 'stripe';

/**
 * One-shot provisioning script for Stripe products + prices in live mode.
 *
 * Idempotent — looks up existing products and prices by `metadata.oneshoplab_id`
 * before creating, so re-running is safe (it'll print [reuse] for everything
 * that's already there). Doesn't write to the DB. The live key is read from
 * `STRIPE_LIVE_SECRET_KEY` so we never overwrite the test key sitting in
 * `.env` accidentally.
 *
 * Usage:
 *   STRIPE_LIVE_SECRET_KEY=sk_live_... tsx scripts/create-stripe-products.mts
 *
 * On exit it prints the env-var lines to drop into .env (live block).
 */

const key = process.env.STRIPE_LIVE_SECRET_KEY;
if (!key || !key.startsWith('sk_live_')) {
  console.error('[abort] STRIPE_LIVE_SECRET_KEY must be set to a live (sk_live_...) secret key.');
  process.exit(1);
}

const stripe = new Stripe(key, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true
});

// Read pricing.json from the repo root — keeps the source of truth in one
// place, so a credit/price tweak there propagates here on next run.
const pricing = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'pricing.json'), 'utf8')
) as {
  plans: Record<'starter' | 'pro' | 'scale' | 'free', { priceEur: number; credits: number }>;
  creditPacks: Record<'boost' | 'power' | 'mega', { priceEur: number; credits: number }>;
};

const YEARLY_DISCOUNT = 0.2;
const yearlyPriceEur = (monthly: number) =>
  Math.round(monthly * 12 * (1 - YEARLY_DISCOUNT) * 100) / 100;
const eurToCents = (amount: number) => Math.round(amount * 100);

interface PlanSpec {
  id: 'starter' | 'pro' | 'scale';
  name: string;
  description: string;
  monthlyEur: number;
  credits: number;
}

const PLANS: PlanSpec[] = (['starter', 'pro', 'scale'] as const).map((id) => ({
  id,
  name: `OneShopLab ${id[0].toUpperCase() + id.slice(1)}`,
  description: `OneShopLab ${id} subscription — ${pricing.plans[id].credits.toLocaleString()} credits/month.`,
  monthlyEur: pricing.plans[id].priceEur,
  credits: pricing.plans[id].credits
}));

interface PackSpec {
  id: 'boost' | 'power' | 'mega';
  name: string;
  description: string;
  priceEur: number;
  credits: number;
}

const PACKS: PackSpec[] = (['boost', 'power', 'mega'] as const).map((id) => ({
  id,
  name: `OneShopLab ${id[0].toUpperCase() + id.slice(1)} Pack`,
  description: `${pricing.creditPacks[id].credits.toLocaleString()} OneShopLab credits — never expire.`,
  priceEur: pricing.creditPacks[id].priceEur,
  credits: pricing.creditPacks[id].credits
}));

async function findProductByMetadata(metaKey: string): Promise<Stripe.Product | null> {
  let starting_after: string | undefined;
  // Walk the active products list until we find one tagged with our id.
  // Stripe Search would work too but `list` keeps this script free of
  // beta-feature dependencies.
  while (true) {
    const page: Stripe.ApiList<Stripe.Product> = await stripe.products.list({
      limit: 100,
      starting_after,
      active: true
    });
    for (const p of page.data) {
      if (p.metadata?.oneshoplab_id === metaKey) return p;
    }
    if (!page.has_more) return null;
    starting_after = page.data[page.data.length - 1].id;
  }
}

async function ensurePrice(opts: {
  product: string;
  metaKey: string;
  unit_amount: number;
  recurring: Stripe.PriceCreateParams.Recurring | undefined;
}): Promise<string> {
  // Same-product prices are short — single page is enough.
  const list = await stripe.prices.list({ product: opts.product, active: true, limit: 100 });
  const existing = list.data.find((pr) => pr.metadata?.oneshoplab_id === opts.metaKey);
  if (existing) {
    if (existing.unit_amount !== opts.unit_amount) {
      console.warn(
        `[warn]    price ${opts.metaKey} amount drift: ${existing.unit_amount} → ${opts.unit_amount} (keeping existing — Stripe doesn't allow editing amounts)`
      );
    }
    console.log(`[reuse]   price   ${opts.metaKey} = ${existing.id}`);
    return existing.id;
  }
  console.log(`[create]  price   ${opts.metaKey} (${opts.unit_amount / 100} EUR)`);
  const created = await stripe.prices.create({
    product: opts.product,
    currency: 'eur',
    unit_amount: opts.unit_amount,
    ...(opts.recurring ? { recurring: opts.recurring } : {}),
    metadata: { oneshoplab_id: opts.metaKey }
  });
  return created.id;
}

async function ensureSubscriptionProduct(spec: PlanSpec): Promise<{
  monthlyPriceId: string;
  yearlyPriceId: string;
}> {
  const metaId = `plan_${spec.id}`;
  let product = await findProductByMetadata(metaId);
  if (!product) {
    console.log(`[create]  product ${metaId}`);
    product = await stripe.products.create({
      name: spec.name,
      description: spec.description,
      metadata: {
        oneshoplab_id: metaId,
        oneshoplab_kind: 'subscription_plan',
        plan: spec.id,
        credits: String(spec.credits)
      }
    });
  } else {
    console.log(`[reuse]   product ${metaId} = ${product.id}`);
  }

  const monthlyId = await ensurePrice({
    product: product.id,
    metaKey: `${metaId}_monthly`,
    unit_amount: eurToCents(spec.monthlyEur),
    recurring: { interval: 'month' }
  });
  const yearlyId = await ensurePrice({
    product: product.id,
    metaKey: `${metaId}_yearly`,
    unit_amount: eurToCents(yearlyPriceEur(spec.monthlyEur)),
    recurring: { interval: 'year' }
  });
  return { monthlyPriceId: monthlyId, yearlyPriceId: yearlyId };
}

async function ensurePackProduct(spec: PackSpec): Promise<string> {
  const metaId = `pack_${spec.id}`;
  let product = await findProductByMetadata(metaId);
  if (!product) {
    console.log(`[create]  product ${metaId}`);
    product = await stripe.products.create({
      name: spec.name,
      description: spec.description,
      metadata: {
        oneshoplab_id: metaId,
        oneshoplab_kind: 'credit_pack',
        pack: spec.id,
        credits: String(spec.credits)
      }
    });
  } else {
    console.log(`[reuse]   product ${metaId} = ${product.id}`);
  }
  return ensurePrice({
    product: product.id,
    metaKey: `${metaId}_oneshot`,
    unit_amount: eurToCents(spec.priceEur),
    recurring: undefined
  });
}

console.log(`[stripe] live account: ${key.slice(0, 12)}…`);
console.log('');

const envLines: string[] = [];

for (const spec of PLANS) {
  const { monthlyPriceId, yearlyPriceId } = await ensureSubscriptionProduct(spec);
  envLines.push(`STRIPE_PRICE_${spec.id.toUpperCase()}_MONTHLY=${monthlyPriceId}`);
  envLines.push(`STRIPE_PRICE_${spec.id.toUpperCase()}_YEARLY=${yearlyPriceId}`);
}
for (const pack of PACKS) {
  const priceId = await ensurePackProduct(pack);
  envLines.push(`STRIPE_PRICE_PACK_${pack.id.toUpperCase()}=${priceId}`);
}

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log(' Live env-vars (paste into .env):');
console.log('════════════════════════════════════════════════════════════════');
for (const line of envLines) console.log(line);
console.log('');
console.log('Reminder: also rotate STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY');
console.log('to live (sk_live_… / pk_live_…) and create a NEW webhook on the');
console.log('live mode dashboard for /api/stripe/webhook (then update');
console.log('STRIPE_WEBHOOK_SECRET to the live signing secret).');
