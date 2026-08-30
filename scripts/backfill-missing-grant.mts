import { eq } from 'drizzle-orm';
import { applyCreditTransaction } from '@/entities/credit';
import { PLAN_TIERS } from '@/entities/ai-model';
import { db } from '@/shared/db';
import { users, subscriptions } from '@/shared/db/schema';
import { getStripeClient, resolvePriceId } from '@/features/billing';

/**
 * Backfill the renewal credit grant for a single user whose
 * `invoice.paid` webhook was silently dropped (Stripe API 2026 broke
 * how we read the subscription id off an invoice — see webhook route
 * commit). Idempotent on `grant-${subId}-${period_start}` so it can
 * safely be re-run, and a future redelivery of the real webhook is
 * a no-op.
 *
 * Usage:
 *   tsx scripts/backfill-missing-grant.mts <userEmail>
 */

const email = process.argv[2];
if (!email) {
  console.error('usage: tsx scripts/backfill-missing-grant.mts <email>');
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
const resolved = resolvePriceId(priceId);
if (!resolved) {
  console.error('cannot resolve price id', priceId);
  process.exit(1);
}
const tier = PLAN_TIERS.find((p) => p.id === resolved.plan);
if (!tier || tier.credits <= 0) {
  console.error('plan has no credit allowance');
  process.exit(1);
}

// Find the most recent paid invoice tied to this subscription. We
// match the same period_start the webhook would have used so the
// idempotency key collides with whatever Stripe eventually replays.
const invoices = await stripe.invoices.list({
  subscription: stripeSub.id,
  status: 'paid',
  limit: 5
} as never);
const invoice = invoices.data[0];
if (!invoice) {
  console.error('no paid invoice on this subscription');
  process.exit(1);
}
const periodStart = invoice.period_start ?? Math.floor(Date.now() / 1000);
const idempotencyKey = `grant-${stripeSub.id}-${periodStart}`;

console.log('user:', u.email, '| plan:', resolved.plan, '| cycle:', resolved.cycle);
console.log('subscription:', stripeSub.id);
console.log('invoice:', invoice.id, 'period_start:', periodStart);
console.log('granting', tier.credits, 'credits with key', idempotencyKey);

const res = await applyCreditTransaction({
  userId: u.id,
  delta: 0,
  setSubscriptionTo: tier.credits,
  reason: `subscription_${resolved.plan}_${resolved.cycle}_grant`,
  idempotencyKey,
  metadata: {
    subscriptionId: stripeSub.id,
    cycle: resolved.cycle,
    periodStart,
    backfill: true
  }
});
console.log('result:', res);
process.exit(0);
