import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { PLAN_TIERS } from '@/entities/ai-model';
import { applyCreditTransaction, nextRefill } from '@/entities/credit';
import { db } from '@/shared/db';
import { subscriptions } from '@/shared/db/schema';

/**
 * Stripe yearly plans are invoiced once a year, but their credits are a
 * monthly allowance ("15 000 crédits / mois, facturé annuellement"). Until
 * 2026-09-27 a yearly subscriber got one month of credits per year. The
 * worker now resets their subscription bucket every month, as long as the
 * subscription is still paid up (`currentPeriodEnd` in the future).
 */
export async function refillStripeYearlySubscriptions(now: Date = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.channel, 'stripe'),
        eq(subscriptions.billingCycle, 'yearly'),
        isNotNull(subscriptions.nextCreditRefillAt),
        lte(subscriptions.nextCreditRefillAt, now)
      )
    )
    .limit(100);
  let refilled = 0;
  for (const s of due) {
    const live = (s.status === 'active' || s.status === 'cancelling') && s.plan !== 'free';
    const paidUp = !s.currentPeriodEnd || s.currentPeriodEnd > now;
    if (!live || !paidUp) {
      await db
        .update(subscriptions)
        .set({ nextCreditRefillAt: null })
        .where(eq(subscriptions.id, s.id));
      continue;
    }
    const tier = PLAN_TIERS.find((t) => t.id === s.plan);
    if (!tier || tier.credits <= 0) continue;
    const dueAt = s.nextCreditRefillAt!;
    await applyCreditTransaction({
      userId: s.userId,
      delta: 0,
      setSubscriptionTo: tier.credits,
      reason: `subscription_${s.plan}_yearly_monthly_refill`,
      idempotencyKey: `refill-${s.id}-${dueAt.toISOString()}`,
      metadata: { channel: 'stripe', subscriptionId: s.stripeSubscriptionId }
    });
    let next = nextRefill(dueAt, 'yearly');
    while (next <= now) next = nextRefill(next, 'yearly');
    await db
      .update(subscriptions)
      .set({ nextCreditRefillAt: next, lastCreditRefillAt: now })
      .where(eq(subscriptions.id, s.id));
    refilled++;
  }
  return refilled;
}

/** Called when a Stripe invoice grants a plan: yearly plans schedule their
 *  next monthly refill, monthly plans rely on their own invoices. */
export async function scheduleStripeRefill(
  userId: string,
  cycle: 'monthly' | 'yearly',
  grantedAt: Date
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ nextCreditRefillAt: cycle === 'yearly' ? nextRefill(grantedAt, 'yearly') : null })
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.channel, 'stripe')));
}
