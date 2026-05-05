'use server';

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { auth } from './auth';
import { db } from './db';
import {
  BILLING_CYCLES,
  subscriptions,
  users,
  type BillingCycle as DbBillingCycle
} from './db/schema';
import {
  PLAN_TIERS,
  getCreditPack,
  type BillingCycle,
  type PlanId
} from './ai/models';
import { getStripeClient, getStripePackPriceId, getStripePriceId } from './stripe';

/**
 * Create (or reuse) a Stripe Checkout session for the requested plan/cycle
 * and redirect the user to it. Reads the current session for the user, finds
 * (or creates) their Stripe Customer, and starts a subscription checkout.
 *
 * On checkout completion, the Stripe webhook (/api/stripe/webhook) flips the
 * `subscriptions` row and grants the monthly credits.
 */
export async function createCheckoutSessionAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=/pricing');

  const planRaw = String(formData.get('plan') ?? '');
  const cycleRaw = String(formData.get('cycle') ?? 'yearly');

  const validPlans: PlanId[] = ['starter', 'pro', 'scale'];
  if (!(validPlans as string[]).includes(planRaw)) redirect('/pricing?error=invalid_plan');
  if (!(BILLING_CYCLES as readonly string[]).includes(cycleRaw))
    redirect('/pricing?error=invalid_cycle');

  const plan = planRaw as PlanId;
  const cycle = cycleRaw as BillingCycle;

  const priceId = getStripePriceId(plan, cycle);
  if (!priceId) redirect(`/pricing?error=price_not_configured`);

  const stripe = getStripeClient();
  const userId = session.user.id;
  const email = session.user.email ?? undefined;
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  // Reuse the existing Stripe Customer if we already have one for this user.
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId)
  });

  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { oneshoplabUserId: userId }
    });
    customerId = customer.id;

    if (existing) {
      await db
        .update(subscriptions)
        .set({ stripeCustomerId: customerId })
        .where(eq(subscriptions.userId, userId));
    } else {
      await db.insert(subscriptions).values({
        id: randomUUID(),
        userId,
        stripeCustomerId: customerId,
        plan: 'free',
        status: 'pending'
      });
    }
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`,
    metadata: {
      oneshoplabUserId: userId,
      plan,
      cycle
    },
    subscription_data: {
      metadata: {
        oneshoplabUserId: userId,
        plan,
        cycle
      }
    },
    allow_promotion_codes: true
  });

  if (!checkout.url) redirect('/pricing?error=stripe_failed');
  redirect(checkout.url);
}

/**
 * Create (or reuse) a Stripe Checkout session for a one-time credit pack
 * purchase. Mirrors createCheckoutSessionAction but with mode='payment' —
 * the webhook handler grants the credits on checkout.session.completed when
 * mode === 'payment'.
 */
export async function buyCreditPackAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=/account/credits');

  const packIdRaw = String(formData.get('packId') ?? '');
  const pack = getCreditPack(packIdRaw);
  if (!pack) redirect('/account/credits?error=invalid_pack');

  const priceId = getStripePackPriceId(pack.id);
  if (!priceId) redirect('/account/credits?error=price_not_configured');

  const stripe = getStripeClient();
  const userId = session.user.id;
  const email = session.user.email ?? undefined;
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  // Reuse the existing Stripe Customer if we already have one (subscription
  // flow may have created one earlier).
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId)
  });

  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { oneshoplabUserId: userId }
    });
    customerId = customer.id;
    if (existing) {
      await db
        .update(subscriptions)
        .set({ stripeCustomerId: customerId })
        .where(eq(subscriptions.userId, userId));
    } else {
      await db.insert(subscriptions).values({
        id: randomUUID(),
        userId,
        stripeCustomerId: customerId,
        plan: 'free',
        status: 'pending'
      });
    }
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/account/credits?purchase=success`,
    cancel_url: `${appUrl}/account/credits?purchase=cancelled`,
    metadata: {
      oneshoplabUserId: userId,
      packId: pack.id,
      credits: String(pack.credits)
    },
    payment_intent_data: {
      metadata: {
        oneshoplabUserId: userId,
        packId: pack.id,
        credits: String(pack.credits)
      }
    }
  });

  if (!checkout.url) redirect('/account/credits?error=stripe_failed');
  redirect(checkout.url);
}

/**
 * Send the user to the Stripe Customer Portal so they can manage their
 * subscription (cancel, change cycle, update payment method).
 */
export async function createPortalSessionAction(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, session.user.id)
  });
  if (!sub?.stripeCustomerId) redirect('/pricing');

  const stripe = getStripeClient();
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${appUrl}/dashboard`
  });

  redirect(portal.url);
}

/**
 * Internal: synchronise a Stripe subscription state into our DB. Called by
 * the webhook for both initial subscriptions and renewals.
 */
export async function syncSubscriptionFromStripe(opts: {
  userId: string;
  customerId: string;
  subscriptionId: string;
  plan: PlanId;
  cycle: BillingCycle;
  priceId: string;
  status: string;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, opts.userId)
  });

  const dbCycle = opts.cycle as DbBillingCycle;

  if (existing) {
    await db
      .update(subscriptions)
      .set({
        stripeCustomerId: opts.customerId,
        stripeSubscriptionId: opts.subscriptionId,
        stripePriceId: opts.priceId,
        plan: opts.plan,
        billingCycle: dbCycle,
        status: opts.status,
        currentPeriodEnd: opts.currentPeriodEnd
      })
      .where(eq(subscriptions.userId, opts.userId));
  } else {
    await db.insert(subscriptions).values({
      id: randomUUID(),
      userId: opts.userId,
      stripeCustomerId: opts.customerId,
      stripeSubscriptionId: opts.subscriptionId,
      stripePriceId: opts.priceId,
      plan: opts.plan,
      billingCycle: dbCycle,
      status: opts.status,
      currentPeriodEnd: opts.currentPeriodEnd
    });
  }

  await db.update(users).set({ plan: opts.plan }).where(eq(users.id, opts.userId));
}

/** Grant a tier's monthly credit allowance to a user (called by webhook). */
export async function grantTierCredits(userId: string, plan: PlanId): Promise<void> {
  const tier = PLAN_TIERS.find((p) => p.id === plan);
  if (!tier || tier.credits <= 0) return;

  // Idempotency hash: one grant per (user, plan, period_start). For this
  // first pass we just call applyCreditTransaction with a unique key per
  // call site (the webhook generates one).
  const { applyCreditTransaction } = await import('./credits');
  await applyCreditTransaction({
    userId,
    delta: tier.credits,
    reason: `subscription_${plan}_grant`,
    idempotencyKey: `grant-${userId}-${plan}-${Date.now()}`
  });
}
