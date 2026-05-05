import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { applyCreditTransaction } from '@/lib/credits';
import { db } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';
import {
  getStripeClient,
  getStripeWebhookSecret,
  resolvePackPriceId,
  resolvePriceId
} from '@/lib/stripe';
import { syncSubscriptionFromStripe } from '@/lib/stripe-actions';
import { getCreditPack, PLAN_TIERS, type PlanId } from '@/lib/ai/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook handler:
 *   - checkout.session.completed → first subscription created, sync DB
 *   - invoice.paid              → renewal or first invoice, grant credits
 *   - customer.subscription.updated / .deleted → status sync
 *
 * All grants are idempotent via idempotencyKey on the credit transaction.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const stripe = getStripeClient();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing_signature' }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, getStripeWebhookSecret());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_signature', message: (err as Error).message },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(stripe, event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      default:
        // Ignore unrelated events. Stripe expects 2xx within 30s.
        break;
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[stripe webhook]', event.type, err);
    return NextResponse.json(
      { error: 'handler_failed', message: (err as Error).message },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(
  stripe: Stripe,
  cs: Stripe.Checkout.Session
): Promise<void> {
  const userId = (cs.metadata?.oneshoplabUserId ?? '') as string;
  if (!userId) return;

  if (cs.mode === 'subscription' && cs.subscription) {
    const subscription = await stripe.subscriptions.retrieve(
      typeof cs.subscription === 'string' ? cs.subscription : cs.subscription.id
    );
    await syncFromStripeSubscription(userId, subscription);
    return;
  }

  if (cs.mode === 'payment') {
    await handleCreditPackPurchase(stripe, cs, userId);
    return;
  }
}

/**
 * One-time credit-pack purchase landed. Resolve the pack via the line-item
 * price ID (preferred — survives stale metadata), fall back to the metadata
 * we set in buyCreditPackAction. Grant atomically with an idempotency key
 * tied to the checkout session so retries don't double-credit.
 */
async function handleCreditPackPurchase(
  stripe: Stripe,
  cs: Stripe.Checkout.Session,
  userId: string
): Promise<void> {
  if (cs.payment_status !== 'paid') return;

  let packId: string | null = null;
  try {
    const items = await stripe.checkout.sessions.listLineItems(cs.id, { limit: 1 });
    const priceId = items.data[0]?.price?.id ?? null;
    if (priceId) packId = resolvePackPriceId(priceId);
  } catch {
    // ignore — we'll fall back to metadata
  }
  if (!packId) packId = (cs.metadata?.packId ?? null) as string | null;

  const pack = getCreditPack(packId);
  if (!pack) {
    console.warn('[stripe webhook] credit pack purchase with unresolved packId', {
      sessionId: cs.id,
      packId,
      metadata: cs.metadata
    });
    return;
  }

  await applyCreditTransaction({
    userId,
    delta: pack.credits,
    bucket: 'pack',
    reason: `pack_${pack.id}_purchase`,
    idempotencyKey: `pack-${cs.id}`,
    metadata: {
      checkoutSessionId: cs.id,
      packId: pack.id,
      packCredits: pack.credits
    }
  });
}

async function handleInvoicePaid(stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  if (!('subscription' in invoice) || !invoice.subscription) return;
  const subId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : (invoice.subscription as Stripe.Subscription).id;

  const subscription = await stripe.subscriptions.retrieve(subId);
  const userId = (subscription.metadata?.oneshoplabUserId ?? '') as string;
  if (!userId) return;

  // Sync state first (status/period_end).
  await syncFromStripeSubscription(userId, subscription);

  // Grant the plan's monthly credit allowance, idempotent on (subscription, period_start).
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) return;
  const resolved = resolvePriceId(priceId);
  if (!resolved) return;

  const tier = PLAN_TIERS.find((p) => p.id === resolved.plan);
  if (!tier || tier.credits <= 0) return;

  const periodStart = invoice.period_start ?? Math.floor(Date.now() / 1000);
  const idempotencyKey = `grant-${subscription.id}-${periodStart}`;

  // Renewal RESETS the subscription bucket to the plan's full allowance —
  // unused subscription credits don't roll over. Pack credits are untouched
  // and remain spendable until consumed. delta is computed inside
  // applyCreditTransaction so the audit trail records the net change.
  await applyCreditTransaction({
    userId,
    delta: 0,
    setSubscriptionTo: tier.credits,
    reason: `subscription_${resolved.plan}_${resolved.cycle}_grant`,
    idempotencyKey,
    metadata: {
      subscriptionId: subscription.id,
      cycle: resolved.cycle,
      periodStart
    }
  });
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const userId = (sub.metadata?.oneshoplabUserId ?? '') as string;
  if (!userId) {
    // Fall back to lookup via stripeCustomerId.
    const found = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeCustomerId, String(sub.customer))
    });
    if (!found) return;
    await syncFromStripeSubscription(found.userId, sub);
    return;
  }
  await syncFromStripeSubscription(userId, sub);
}

async function syncFromStripeSubscription(
  userId: string,
  sub: Stripe.Subscription
): Promise<void> {
  const priceId = sub.items.data[0]?.price.id;
  if (!priceId) return;

  // Fall back to metadata for plan/cycle when the price isn't yet in our env
  // map (e.g. test-mode price IDs while developing).
  const metaPlan = (sub.metadata?.plan ?? '') as PlanId;
  const metaCycle = (sub.metadata?.cycle ?? '') as 'monthly' | 'yearly';
  const resolved = resolvePriceId(priceId) ?? {
    plan: (['starter', 'pro', 'scale'] as PlanId[]).includes(metaPlan) ? metaPlan : null,
    cycle: metaCycle === 'monthly' || metaCycle === 'yearly' ? metaCycle : null
  };
  if (!resolved.plan || !resolved.cycle) {
    console.warn('[stripe] unresolved price+metadata for', priceId);
    return;
  }

  // In API 2026-04-22+ `current_period_end` lives on the subscription item.
  // Fall back to the legacy top-level field for forward/backward compat.
  const itemPeriodEnd = sub.items.data[0]?.current_period_end;
  const legacyPeriodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  const periodEndUnix =
    typeof itemPeriodEnd === 'number'
      ? itemPeriodEnd
      : typeof legacyPeriodEnd === 'number'
        ? legacyPeriodEnd
        : null;
  const periodEnd = periodEndUnix != null ? new Date(periodEndUnix * 1000) : null;
  const status = sub.cancel_at_period_end ? 'cancelling' : sub.status;
  const planForDb = sub.status === 'canceled' ? ('free' as PlanId) : resolved.plan;

  await syncSubscriptionFromStripe({
    userId,
    customerId: String(sub.customer),
    subscriptionId: sub.id,
    plan: planForDb,
    cycle: resolved.cycle,
    priceId,
    status,
    currentPeriodEnd: periodEnd
  });
}

