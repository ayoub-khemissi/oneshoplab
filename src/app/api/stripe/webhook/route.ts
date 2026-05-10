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
 * Stripe webhook handler. Subscribed events (live + test endpoints):
 *
 *   Indispensable
 *   - checkout.session.completed     first sub created OR pack purchase → sync DB / grant pack
 *   - invoice.paid                   plan grants — billing_reason switches between
 *                                    "reset bucket" (create/cycle) and "delta only" (update)
 *   - customer.subscription.updated  plan/cycle/status sync (cancellation flips, etc.)
 *   - customer.subscription.deleted  final cancellation at period end
 *
 *   Resilience
 *   - customer.subscription.created  duplicates checkout.session.completed for sub-mode but
 *                                    catches subs created outside Checkout. Safe + idempotent
 *   - invoice.payment_failed         flips DB to past_due as soon as the failed-payment event
 *                                    fires, without waiting for the asynchronous
 *                                    customer.subscription.updated
 *
 * All credit grants pass an idempotencyKey tied to invoice.id so a Stripe-side retry of
 * the same event never double-grants.
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
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(stripe, event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.created':
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
  // Resolving the subscription id from an Invoice changed shape in API
  // 2026-04-22.dahlia: the legacy top-level `invoice.subscription` field
  // is gone, replaced by `invoice.parent.subscription_details.subscription`.
  // Read the new location first, fall back to the legacy field for
  // forward/backward compatibility (and just in case we ever pin to an
  // older API version).
  const subId = extractInvoiceSubscriptionId(invoice);
  if (!subId) return;

  const subscription = await stripe.subscriptions.retrieve(subId);
  const userId = (subscription.metadata?.oneshoplabUserId ?? '') as string;
  if (!userId) return;

  // Sync state first (status/period_end). Sets the DB to the *new* plan, so
  // we can't read the old plan from there anymore — we'll read it off the
  // proration line items below for the upgrade path.
  await syncFromStripeSubscription(userId, subscription);

  const newPriceId = subscription.items.data[0]?.price.id;
  if (!newPriceId) return;
  const newResolved = resolvePriceId(newPriceId);
  if (!newResolved) return;

  const newTier = PLAN_TIERS.find((p) => p.id === newResolved.plan);
  if (!newTier || newTier.credits <= 0) return;

  // One grant per invoice. Stripe invoice IDs are unique account-wide so
  // this is safe across retries and across plan switches that produce
  // multiple invoices in the same period.
  const idempotencyKey = `grant-inv-${invoice.id}`;
  const reason = invoice.billing_reason;

  if (
    reason === 'subscription_create' ||
    reason === 'subscription_cycle' ||
    reason === 'subscription'
  ) {
    // First invoice (sub creation) or automatic period renewal. The
    // subscription bucket is RESET to the plan's full allowance — unused
    // sub credits don't roll over. Pack credits are untouched and stay
    // spendable.
    await applyCreditTransaction({
      userId,
      delta: 0,
      setSubscriptionTo: newTier.credits,
      reason: `subscription_${newResolved.plan}_${newResolved.cycle}_${
        reason === 'subscription_cycle' ? 'renewal' : 'grant'
      }`,
      idempotencyKey,
      metadata: {
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        cycle: newResolved.cycle,
        billingReason: reason,
        periodStart: invoice.period_start ?? null
      }
    });
    return;
  }

  if (reason === 'subscription_update') {
    // Mid-cycle plan/cycle change. We must NOT reset the subscription
    // bucket — that'd let a user burn through Pro credits then upgrade to
    // Scale 2h later for ~the price of a Scale month and walk away with a
    // fresh full Scale allowance on top of the Pro consumption. Instead we
    // grant only the *delta* of plan caps (newCredits - oldCredits), and
    // skip entirely on downgrades or same-plan cycle swaps.
    const oldPriceId = findOldPriceFromProrationLines(invoice, newPriceId);
    const oldResolved = oldPriceId ? resolvePriceId(oldPriceId) : null;
    if (!oldResolved) {
      // Couldn't identify the previous plan from the line items. Better
      // to under-grant than to over-grant — bail loudly so we can
      // investigate from logs.
      console.warn('[stripe webhook] subscription_update: unresolved old price', {
        invoiceId: invoice.id,
        oldPriceId,
        newPriceId
      });
      return;
    }
    const oldTier = PLAN_TIERS.find((p) => p.id === oldResolved.plan);
    if (!oldTier) return;

    const delta = newTier.credits - oldTier.credits;
    if (delta <= 0) {
      // Downgrade or pure cycle change (monthly ↔ yearly, same plan):
      // do nothing. The user keeps whatever subscription credits they
      // still hold; the new (smaller or equal) cap takes effect at the
      // next renewal.
      return;
    }

    await applyCreditTransaction({
      userId,
      delta,
      bucket: 'subscription',
      reason: `subscription_${oldResolved.plan}_to_${newResolved.plan}_upgrade_delta`,
      idempotencyKey,
      metadata: {
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        oldPlan: oldResolved.plan,
        newPlan: newResolved.plan,
        oldCredits: oldTier.credits,
        newCredits: newTier.credits,
        delta,
        billingReason: reason
      }
    });
    return;
  }

  // manual / quote_accept / subscription_threshold / upcoming /
  // automatic_pending_invoice_item_invoice — none of these should grant
  // subscription credits. Ignore.
}

/**
 * Pull the OLD plan's price id off a `subscription_update` proration
 * invoice. Stripe emits two proration lines on a plan switch:
 *   - one negative-amount line crediting the unused time on the old price
 *   - one positive-amount line charging the remaining time on the new price
 * The negative line carries the OLD price id we want.
 *
 * Falls back to "any negative line that isn't the new price" so we still
 * catch cycle changes that don't flag proration explicitly. Returns null
 * when nothing matches.
 */
function findOldPriceFromProrationLines(
  invoice: Stripe.Invoice,
  newPriceId: string
): string | null {
  const lines = invoice.lines?.data ?? [];
  const isProration = (line: Stripe.InvoiceLineItem) =>
    line.parent?.subscription_item_details?.proration === true;
  const priceOf = (line: Stripe.InvoiceLineItem): string | null => {
    const price = line.pricing?.price_details?.price;
    if (typeof price === 'string') return price;
    if (price && typeof price === 'object' && 'id' in price)
      return (price as { id?: string }).id ?? null;
    return null;
  };

  const negProration = lines.find((l) => l.amount < 0 && isProration(l));
  if (negProration) {
    const id = priceOf(negProration);
    if (id) return id;
  }
  const negAny = lines.find((l) => l.amount < 0);
  if (negAny) {
    const id = priceOf(negAny);
    if (id && id !== newPriceId) return id;
  }
  return null;
}

/**
 * Charge attempt failed. Stripe will (eventually) flip the subscription
 * status to `past_due` and emit `customer.subscription.updated` — but that
 * can lag by minutes when the dunning retry path kicks in. Re-pull the
 * subscription now and sync so the UI shows the warning banner without
 * waiting for the second event.
 */
async function handleInvoicePaymentFailed(
  stripe: Stripe,
  invoice: Stripe.Invoice
): Promise<void> {
  const subId = extractInvoiceSubscriptionId(invoice);
  if (!subId) return;

  const subscription = await stripe.subscriptions.retrieve(subId);
  const userId = (subscription.metadata?.oneshoplabUserId ?? '') as string;
  if (userId) {
    await syncFromStripeSubscription(userId, subscription);
    return;
  }
  // Metadata-less subs (legacy): look up by customer id.
  const found = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeCustomerId, String(subscription.customer))
  });
  if (!found) return;
  await syncFromStripeSubscription(found.userId, subscription);
}

/**
 * Pull the subscription id out of an Invoice across Stripe API
 * versions. As of 2026-04-22.dahlia, the canonical location is
 * `invoice.parent.subscription_details.subscription` for an invoice
 * generated by a subscription billing run. Older versions exposed it
 * directly as `invoice.subscription`. Returns null for one-off
 * invoices that aren't tied to a subscription at all.
 */
function extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const newShape = (
    invoice as unknown as {
      parent?: {
        subscription_details?: {
          subscription?: string | { id?: string } | null;
        } | null;
      } | null;
    }
  ).parent?.subscription_details?.subscription;
  if (newShape) {
    return typeof newShape === 'string' ? newShape : (newShape.id ?? null);
  }
  const legacy = (invoice as unknown as { subscription?: string | { id?: string } | null })
    .subscription;
  if (legacy) {
    return typeof legacy === 'string' ? legacy : (legacy.id ?? null);
  }
  return null;
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

  // Cancellation signal moved in API 2026: instead of setting
  // `cancel_at_period_end=true` and leaving `status='active'`, Stripe
  // now sets `cancel_at` to a future timestamp on an otherwise-active
  // subscription. Treat both shapes as "cancelling" — the user has
  // already cancelled but their plan is still live until period end.
  // When `cancel_at` is set, we surface that as the effective end
  // date even if it doesn't match `current_period_end` (in practice
  // they're equal for cycle-end cancellations, but a custom cancel-at
  // date should display correctly too).
  const cancelAtUnix = typeof sub.cancel_at === 'number' ? sub.cancel_at : null;
  const isCancellingNew = cancelAtUnix !== null && sub.status !== 'canceled';
  const isCancellingLegacy = sub.cancel_at_period_end === true;
  const isCancelling = isCancellingNew || isCancellingLegacy;
  const effectivePeriodEndUnix = isCancellingNew
    ? cancelAtUnix
    : periodEndUnix;
  const periodEnd =
    effectivePeriodEndUnix != null ? new Date(effectivePeriodEndUnix * 1000) : null;
  const status = isCancelling ? 'cancelling' : sub.status;
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

