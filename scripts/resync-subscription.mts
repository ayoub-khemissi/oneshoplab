import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { subscriptions, users } from '@/lib/db/schema';
import { getStripeClient, resolvePriceId } from '@/lib/stripe';
import { syncSubscriptionFromStripe } from '@/lib/stripe-actions';
import type { PlanId } from '@/lib/ai/models';

/**
 * Re-pull a user's subscription state from Stripe and write it to the DB
 * with the latest sync logic. Useful when an upstream change (e.g. the
 * Stripe API 2026 cancel_at move) made an earlier webhook misread the
 * state. Idempotent.
 *
 * Usage: tsx scripts/resync-subscription.mts <email>
 */

const email = process.argv[2];
if (!email) {
  console.error('usage: tsx scripts/resync-subscription.mts <email>');
  process.exit(1);
}

const u = await db.query.users.findFirst({ where: eq(users.email, email) });
if (!u) {
  console.error('user not found:', email);
  process.exit(1);
}
const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, u.id) });
if (!sub?.stripeSubscriptionId) {
  console.error('no stripe subscription for', email);
  process.exit(1);
}

const stripe = getStripeClient();
const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

const priceId = stripeSub.items.data[0]?.price.id;
if (!priceId) {
  console.error('subscription has no price item');
  process.exit(1);
}
const metaPlan = (stripeSub.metadata?.plan ?? '') as PlanId;
const metaCycle = (stripeSub.metadata?.cycle ?? '') as 'monthly' | 'yearly';
const resolved = resolvePriceId(priceId) ?? {
  plan: (['starter', 'pro', 'scale'] as PlanId[]).includes(metaPlan) ? metaPlan : null,
  cycle: metaCycle === 'monthly' || metaCycle === 'yearly' ? metaCycle : null
};
if (!resolved.plan || !resolved.cycle) {
  console.error('cannot resolve plan/cycle for price', priceId);
  process.exit(1);
}

const itemPeriodEnd = stripeSub.items.data[0]?.current_period_end;
const legacyPeriodEnd = (stripeSub as unknown as { current_period_end?: number })
  .current_period_end;
const periodEndUnix =
  typeof itemPeriodEnd === 'number'
    ? itemPeriodEnd
    : typeof legacyPeriodEnd === 'number'
      ? legacyPeriodEnd
      : null;
const cancelAtUnix = typeof stripeSub.cancel_at === 'number' ? stripeSub.cancel_at : null;
const isCancellingNew = cancelAtUnix !== null && stripeSub.status !== 'canceled';
const isCancellingLegacy = stripeSub.cancel_at_period_end === true;
const isCancelling = isCancellingNew || isCancellingLegacy;
const effectivePeriodEndUnix = isCancellingNew ? cancelAtUnix : periodEndUnix;
const periodEnd = effectivePeriodEndUnix != null ? new Date(effectivePeriodEndUnix * 1000) : null;
const status = isCancelling ? 'cancelling' : stripeSub.status;
const planForDb: PlanId = stripeSub.status === 'canceled' ? 'free' : (resolved.plan as PlanId);

console.log('user:', u.email);
console.log(
  'stripe.status:',
  stripeSub.status,
  '| cancel_at:',
  cancelAtUnix,
  '| cap_end:',
  stripeSub.cancel_at_period_end
);
console.log(
  '→ writing status:',
  status,
  '| plan:',
  planForDb,
  '| period_end:',
  periodEnd?.toISOString()
);

await syncSubscriptionFromStripe({
  userId: u.id,
  customerId: String(stripeSub.customer),
  subscriptionId: stripeSub.id,
  plan: planForDb,
  cycle: resolved.cycle as 'monthly' | 'yearly',
  priceId,
  status,
  currentPeriodEnd: periodEnd
});
console.log('done');
process.exit(0);
