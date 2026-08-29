import Stripe from 'stripe';
import type { BillingCycle, CreditPackId, PlanId } from './ai/models';

/**
 * Lazily-instantiated Stripe client. We don't fail at import time when
 * `STRIPE_SECRET_KEY` is missing — the homepage and dashboard work without it
 * (free tier). Calls that hit Stripe (checkout / webhook) explicitly call
 * `getStripeClient()` and surface a clear error.
 */
let _stripe: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set. Add it to .env to enable subscriptions.');
  }
  _stripe = new Stripe(key, {
    apiVersion: '2026-04-22.dahlia',
    typescript: true
  });
  return _stripe;
}

/**
 * Resolves a `(plan, cycle)` pair to the Stripe Price ID configured via env
 * variables. Naming convention: `STRIPE_PRICE_<PLAN>_<CYCLE>` (uppercased),
 * e.g. `STRIPE_PRICE_STARTER_MONTHLY=price_abc...`.
 *
 * Returns `null` when the price isn't configured yet (lets the UI gracefully
 * disable the CTA instead of crashing).
 */
export function getStripePriceId(plan: PlanId, cycle: BillingCycle): string | null {
  if (plan === 'free') return null;
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
  const value = process.env[key];
  return value && value.length > 0 ? value : null;
}

/** Inverse of getStripePriceId: looks up the (plan, cycle) of a given price. */
export function resolvePriceId(priceId: string): { plan: PlanId; cycle: BillingCycle } | null {
  const plans: PlanId[] = ['starter', 'pro', 'scale'];
  const cycles: BillingCycle[] = ['monthly', 'yearly'];
  for (const plan of plans) {
    for (const cycle of cycles) {
      if (getStripePriceId(plan, cycle) === priceId) {
        return { plan, cycle };
      }
    }
  }
  return null;
}

/**
 * Resolves a credit-pack id to its Stripe Price ID configured via
 * `STRIPE_PRICE_PACK_<PACK>`. Returns null when not configured (lets the UI
 * disable the buy button gracefully instead of erroring).
 */
export function getStripePackPriceId(packId: CreditPackId): string | null {
  const key = `STRIPE_PRICE_PACK_${packId.toUpperCase()}`;
  const value = process.env[key];
  return value && value.length > 0 ? value : null;
}

/** Inverse: maps a price ID back to a pack id (used by the webhook). */
export function resolvePackPriceId(priceId: string): CreditPackId | null {
  const packs: CreditPackId[] = ['boost', 'power', 'mega'];
  for (const pack of packs) {
    if (getStripePackPriceId(pack) === priceId) return pack;
  }
  return null;
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set. Add it to .env to verify webhook signatures.'
    );
  }
  return secret;
}
