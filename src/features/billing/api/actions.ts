'use server';

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import {
  BILLING_CYCLES,
  subscriptions,
  users,
  type BillingCycle as DbBillingCycle
} from '@/shared/db/schema';
import { PLAN_TIERS, getCreditPack, type BillingCycle, type PlanId } from '@/entities/ai-model';
import { checkoutConsentParams } from '@/entities/legal-consent';
import { getStripeClient, getStripePackPriceId, getStripePriceId } from './stripe';
import type Stripe from 'stripe';

/**
 * Build the `&value=…&currency=…` query suffix for a Checkout success
 * URL from a Stripe Price id, so the success page's Meta Pixel
 * `Purchase` event can report revenue (ROAS optimization). Best-effort:
 * any failure (network, missing unit_amount on a metered price)
 * returns an empty string and the event just fires without a value.
 */
async function stripePriceValueParam(stripe: Stripe, priceId: string): Promise<string> {
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount == null) return '';
    const value = (price.unit_amount / 100).toFixed(2);
    const currency = (price.currency || 'eur').toLowerCase();
    return `&value=${value}&currency=${currency}`;
  } catch {
    return '';
  }
}

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
      metadata: {
        oneshoplabUserId: userId,
        // What the affiliate network matches a subscription on: the same id we
        // reported as the lead's `uid` at signup. Without it a referred
        // merchant's recurring commission never attaches to their promoter.
        fp_uid: userId
      }
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

  // Resolve the price amount so the success-page Meta `Purchase` event
  // can carry value+currency (needed for ROAS-based ad optimization).
  // Best-effort: a failed retrieve just omits the value, the event
  // still fires as a conversion count. Yearly ≠ monthly×12 (−20%), so
  // we read Stripe's authoritative unit_amount rather than computing.
  const valueParam = await stripePriceValueParam(stripe, priceId);
  // Mandatory Terms/Privacy checkbox + withdrawal waiver, in the buyer's
  // locale; the acceptance comes back on checkout.session.completed and
  // is persisted in legal_consents by the webhook.
  const consent = await checkoutConsentParams();

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    ...consent,
    line_items: [{ price: priceId, quantity: 1 }],
    // sid = Stripe-substituted Checkout Session id → GA4 transaction_id
    // (natural purchase dedupe). plan/cycle drive the GA4 item label;
    // value/currency feed the Meta Pixel Purchase event.
    success_url: `${appUrl}/dashboard?checkout=success&sid={CHECKOUT_SESSION_ID}&plan=${plan}&cycle=${cycle}${valueParam}`,
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

  if (!checkout.url) redirect('/pricing?error=payment_failed');
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
      metadata: {
        oneshoplabUserId: userId,
        // What the affiliate network matches a subscription on: the same id we
        // reported as the lead's `uid` at signup. Without it a referred
        // merchant's recurring commission never attaches to their promoter.
        fp_uid: userId
      }
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

  // pack.priceEur is the exact list price (no yearly/proration nuance
  // on a one-time pack), so feed the Meta Purchase value straight from
  // pricing config — no Stripe round-trip needed.
  const packValueParam = `&value=${pack.priceEur.toFixed(2)}&currency=eur`;
  const consent = await checkoutConsentParams();

  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    ...consent,
    line_items: [{ price: priceId, quantity: 1 }],
    // sid → GA4 transaction_id (purchase dedupe); pack → GA4 item label;
    // value/currency feed the Meta Pixel Purchase event.
    success_url: `${appUrl}/account/credits?purchase=success&sid={CHECKOUT_SESSION_ID}&pack=${pack.id}${packValueParam}`,
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

  if (!checkout.url) redirect('/account/credits?error=payment_failed');
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
  const { applyCreditTransaction } = await import('@/entities/credit');
  await applyCreditTransaction({
    userId,
    delta: tier.credits,
    reason: `subscription_${plan}_grant`,
    idempotencyKey: `grant-${userId}-${plan}-${Date.now()}`
  });
}
