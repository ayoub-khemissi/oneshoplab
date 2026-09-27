/**
 * Wix Billing for merchants who installed the app from Wix (App Market
 * guideline "Accepting payments": any charge goes through Wix). Same plans,
 * same packs, same credit rules as Stripe and Shopify — only the till
 * changes:
 *
 * - a plan is a recurring Wix plan (one GUID per tier, monthly or yearly);
 *   the site's app instance says which one runs (`billing`);
 * - a pack is a "single" Wix plan, bought once; the purchase history lists it;
 * - Wix announces no per-cycle payment, so monthly credit refills are
 *   scheduled (`nextCreditRefillAt`) and checked against Wix before granting.
 *
 * Wix is the source of truth: webhooks and returns only tell us to look,
 * every decision re-reads the instance and the purchase history.
 */
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import {
  getCreditPack,
  PLAN_TIERS,
  wixProductId,
  wixProductKey,
  type BillingCycle,
  type CreditPackId,
  type PlanId
} from '@/entities/ai-model';
import { applyCreditTransaction, grantTestCredits, nextRefill } from '@/entities/credit';
import {
  getWixInstance,
  installedWixInstancesFor,
  markWixInstanceUninstalled,
  settleBillingChannel
} from '@/entities/shop-connection';
import { db } from '@/shared/db';
import { subscriptions, users } from '@/shared/db/schema';
import { wixAppConfig } from '../lib/config';
import {
  getAppInstance,
  getCheckoutUrl,
  getPurchaseHistory,
  type WixAppInstance,
  type WixPaymentCycle,
  type WixPurchase
} from './app-management';
import { createWixClient, type WixClient } from './client';

type PaidPlan = Exclude<PlanId, 'free'>;
const PAID_PLANS: readonly PaidPlan[] = ['starter', 'pro', 'scale'];

export interface WixBillingDeps {
  makeClient?: typeof createWixClient;
  now?: Date;
}

/** The app inside the merchant's Wix dashboard — where every flow ends. */
export function wixDashboardAppUrl(instanceId: string): string {
  const appId = wixAppConfig()?.appId ?? '';
  return `https://www.wix.com/my-account/app/${appId}/${instanceId}`;
}

function clientFor(instanceId: string, deps: WixBillingDeps): WixClient | null {
  const cfg = wixAppConfig();
  if (!cfg) return null;
  return (deps.makeClient ?? createWixClient)({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    instanceId
  });
}

async function ownerOf(instanceId: string) {
  const row = await getWixInstance(instanceId);
  if (!row?.userId || row.uninstalledAt) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  return user ? { row, user } : null;
}

function isPaidPlan(key: string | null): key is PaidPlan {
  return Boolean(key && (PAID_PLANS as readonly string[]).includes(key));
}

function cycleOf(c: WixPaymentCycle | null): BillingCycle | null {
  return c === 'MONTHLY' ? 'monthly' : c === 'YEARLY' ? 'yearly' : null;
}

const rank = (plan: string) => PLAN_TIERS.findIndex((t) => t.id === plan);

// ------------------------------------------------------------------ starting a purchase

export type WixCheckoutTarget =
  { kind: 'plan'; plan: PaidPlan; cycle: BillingCycle } | { kind: 'pack'; pack: CreditPackId };

export type WixCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | {
      ok: false;
      reason:
        | 'not_linked'
        | 'not_wix_billing'
        | 'not_configured'
        | 'current_plan'
        | 'downgrade'
        | 'unreachable';
      error?: string;
    };

/**
 * A Wix checkout link for a plan or a pack. Wix bills downgrades (and yearly
 * → monthly) as a cancellation plus a new purchase, so they are refused here:
 * the merchant cancels in Wix, then picks the lower plan.
 */
export async function startWixCheckout(
  instanceId: string,
  target: WixCheckoutTarget,
  deps: WixBillingDeps = {}
): Promise<WixCheckoutResult> {
  const owner = await ownerOf(instanceId);
  if (!owner) return { ok: false, reason: 'not_linked' };
  if (owner.user.billingChannel !== 'wix') return { ok: false, reason: 'not_wix_billing' };
  const productId = wixProductId(target.kind === 'plan' ? target.plan : target.pack);
  const client = clientFor(instanceId, deps);
  if (!productId || !client) return { ok: false, reason: 'not_configured' };
  if (target.kind === 'plan') {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, owner.user.id)
    });
    const running =
      sub && sub.channel === 'wix' && sub.status === 'active' && sub.plan !== 'free' ? sub : null;
    if (running) {
      if (running.plan === target.plan && running.billingCycle === target.cycle)
        return { ok: false, reason: 'current_plan' };
      const lower = rank(target.plan) < rank(running.plan);
      const shorter =
        running.plan === target.plan &&
        running.billingCycle === 'yearly' &&
        target.cycle === 'monthly';
      if (lower || shorter) return { ok: false, reason: 'downgrade' };
    }
  }
  try {
    const checkoutUrl = await getCheckoutUrl(client, {
      productId,
      billingCycle:
        target.kind === 'pack' ? 'ONE_TIME' : target.cycle === 'yearly' ? 'YEARLY' : 'MONTHLY',
      successUrl: wixDashboardAppUrl(instanceId)
    });
    return { ok: true, checkoutUrl };
  } catch (e) {
    return { ok: false, reason: 'unreachable', error: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------ applying what Wix says

export type WixPlanOutcome =
  | 'no_owner'
  | 'not_wix_billing'
  | 'canceled'
  | 'unchanged'
  | 'activated'
  | 'unknown_plan'
  | 'other_site';

/** The purchase behind the running plan: renewals keep it, a new purchase changes it. */
function purchaseKey(inst: WixAppInstance): string | null {
  const b = inst.billing;
  if (!b?.packageName || !b.billingCycle) return null;
  return `${b.packageName}|${b.billingCycle}|${b.timeStamp ?? ''}`.slice(0, 191);
}

/** A purchase at 0.00 — every purchase before the app is listed — proves the flow, not a payment. */
function isTestPurchase(
  history: WixPurchase[],
  productId: string,
  cycle: WixPaymentCycle | null
): boolean {
  const match = [...history]
    .reverse()
    .find((p) => p.productId === productId && (!cycle || p.billingCycle === cycle));
  return match ? match.price <= 0 : !wixAppConfig()?.published;
}

async function applyWixPlan(
  owner: NonNullable<Awaited<ReturnType<typeof ownerOf>>>,
  inst: WixAppInstance,
  history: WixPurchase[],
  now: Date
): Promise<WixPlanOutcome> {
  const { user, row } = owner;
  const instanceId = row.instanceId;
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, user.id)
  });
  const key = wixProductKey(inst.billing?.packageName);
  const cycle = cycleOf(inst.billing?.billingCycle ?? null);
  const hasPlan = !inst.isFree && isPaidPlan(key) && cycle !== null;

  if (!hasPlan) {
    // Only the site that sold the plan can end it: a second, free Wix site
    // must not cancel a plan bought on the first.
    if (existing?.channel === 'wix' && existing.wixInstanceId === instanceId) {
      await db
        .update(subscriptions)
        .set({ plan: 'free', status: 'canceled', nextCreditRefillAt: null, wixPurchaseKey: null })
        .where(eq(subscriptions.userId, user.id));
      await db.update(users).set({ plan: 'free' }).where(eq(users.id, user.id));
      return 'canceled';
    }
    return !inst.isFree && inst.billing?.billingCycle !== 'ONE_TIME' ? 'unknown_plan' : 'unchanged';
  }
  if (user.billingChannel !== 'wix') return 'not_wix_billing';

  const plan = key;
  const tier = PLAN_TIERS.find((t) => t.id === plan)!;
  const pKey = purchaseKey(inst);
  const isNew = !existing || existing.wixPurchaseKey !== pKey;
  const test = isTestPurchase(history, inst.billing!.packageName!, inst.billing!.billingCycle);
  const previousPaid =
    existing && existing.status === 'active' && existing.plan !== 'free'
      ? (PLAN_TIERS.find((t) => t.id === existing.plan) ?? null)
      : null;
  const values = {
    channel: 'wix' as const,
    plan,
    billingCycle: cycle,
    status: 'active',
    currentPeriodEnd: inst.billing?.expirationDate ? new Date(inst.billing.expirationDate) : null,
    wixInstanceId: instanceId,
    wixPurchaseKey: pKey,
    // Test purchases are never refilled (see grantTestCredits).
    ...(isNew ? { nextCreditRefillAt: test ? null : nextRefill(now, cycle) } : {})
  };
  if (existing) {
    await db.update(subscriptions).set(values).where(eq(subscriptions.userId, user.id));
  } else {
    await db.insert(subscriptions).values({ id: crypto.randomUUID(), userId: user.id, ...values });
  }
  await db.update(users).set({ plan }).where(eq(users.id, user.id));
  if (!isNew) return 'unchanged';

  const idempotencyKey = `wix-sub-${instanceId}-${pKey}`.slice(0, 128);
  const meta = { channel: 'wix', instanceId, plan, cycle, purchase: pKey };
  const requested = previousPaid ? Math.max(0, tier.credits - previousPaid.credits) : tier.credits;
  if (test) {
    await grantTestCredits({
      userId: user.id,
      requested,
      reason: 'wix_test_grant',
      idempotencyKey,
      metadata: meta
    });
  } else if (!previousPaid) {
    await applyCreditTransaction({
      userId: user.id,
      delta: 0,
      setSubscriptionTo: tier.credits,
      reason: `subscription_${plan}_${cycle}_grant`,
      idempotencyKey,
      metadata: meta
    });
  } else if (requested > 0) {
    await applyCreditTransaction({
      userId: user.id,
      delta: requested,
      bucket: 'subscription',
      reason: `subscription_${previousPaid.id}_to_${plan}_upgrade_delta`,
      idempotencyKey,
      metadata: meta
    });
  }
  return 'activated';
}

/**
 * Every pack in the site's purchase history is credited once (the ledger's
 * idempotency key is the purchase itself), whatever told us to look.
 */
async function grantWixPacks(
  userId: string,
  instanceId: string,
  history: WixPurchase[]
): Promise<number> {
  let granted = 0;
  for (const p of history) {
    const key = wixProductKey(p.productId);
    const pack = key && !isPaidPlan(key) ? getCreditPack(key as CreditPackId) : null;
    if (!pack) continue;
    const idempotencyKey = `wix-pack-${instanceId}-${p.productId}-${p.dateCreated}`.slice(0, 128);
    const meta = { channel: 'wix', instanceId, packId: pack.id, purchasedAt: p.dateCreated };
    if (p.price <= 0) {
      await grantTestCredits({
        userId,
        requested: pack.credits,
        reason: 'wix_test_grant',
        idempotencyKey,
        metadata: meta
      });
    } else {
      const res = await applyCreditTransaction({
        userId,
        delta: pack.credits,
        bucket: 'pack',
        reason: `pack_${pack.id}_purchase`,
        idempotencyKey,
        metadata: { ...meta, price: p.price, currency: p.currency }
      });
      if (!res.alreadyApplied) granted++;
    }
  }
  return granted;
}

export interface WixBillingSync {
  plan: WixPlanOutcome;
  packsGranted: number;
}

/** Mirrors the site's Wix plan and pack purchases into our rows and credits. */
export async function syncWixBilling(
  instanceId: string,
  deps: WixBillingDeps = {}
): Promise<WixBillingSync | null> {
  const owner = await ownerOf(instanceId);
  const client = clientFor(instanceId, deps);
  if (!owner || !client) return null;
  const [inst, history] = await Promise.all([getAppInstance(client), getPurchaseHistory(client)]);
  if (!inst) return null;
  const packsGranted = await grantWixPacks(owner.user.id, instanceId, history);
  const plan = await applyWixPlan(owner, inst, history, deps.now ?? new Date());
  return { plan, packsGranted };
}

// ------------------------------------------------------------------ uninstall

/** Wix ends the app's plan when the app is removed; mirror it, then settle the channel. */
export async function onWixAppRemoved(instanceId: string): Promise<void> {
  const owner = await ownerOf(instanceId);
  await markWixInstanceUninstalled(instanceId);
  if (!owner) return;
  const [ended] = await db
    .update(subscriptions)
    .set({ plan: 'free', status: 'canceled', nextCreditRefillAt: null, wixPurchaseKey: null })
    .where(
      and(
        eq(subscriptions.userId, owner.user.id),
        eq(subscriptions.channel, 'wix'),
        eq(subscriptions.wixInstanceId, instanceId)
      )
    );
  if (ended.affectedRows > 0) {
    await db.update(users).set({ plan: 'free' }).where(eq(users.id, owner.user.id));
  }
  await settleBillingChannel(owner.user.id);
}

// ------------------------------------------------------------------ links

/**
 * Where a Wix-billed merchant manages plan and packs from the website: the
 * app in the Wix dashboard of the site that sold the plan (or any installed
 * one). Null for other channels.
 */
export async function wixManageUrlFor(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { billingChannel: true }
  });
  if (user?.billingChannel !== 'wix') return null;
  const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) });
  const sites = await installedWixInstancesFor(userId);
  const site = sites.find((s) => s.instanceId === sub?.wixInstanceId) ?? sites[0] ?? null;
  return site ? wixDashboardAppUrl(site.instanceId) : null;
}

/**
 * Where plan and packs are managed for this merchant, or null when Wix does
 * not bill them. Inside the Wix dashboard it is always the dashboard page
 * (same frame): no Stripe screen may open there.
 */
export async function wixBillingLink(userId: string, embedded: boolean): Promise<string | null> {
  if (embedded) return '/wix';
  return wixManageUrlFor(userId);
}

// ------------------------------------------------------------------ monthly refills

/**
 * Worker tick. For each Wix-billed plan whose refill is due, asks Wix whether
 * the same purchase still runs, then resets the subscription bucket to the
 * plan's monthly allowance (use-it-or-lose-it, as on Stripe).
 */
export async function refillWixSubscriptions(deps: WixBillingDeps = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const due = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.channel, 'wix'),
        eq(subscriptions.status, 'active'),
        isNotNull(subscriptions.nextCreditRefillAt),
        lte(subscriptions.nextCreditRefillAt, now)
      )
    )
    .limit(50);
  let refilled = 0;
  for (const s of due) {
    const instanceId = s.wixInstanceId;
    if (!instanceId) continue;
    try {
      const owner = await ownerOf(instanceId);
      const client = clientFor(instanceId, deps);
      if (!owner || !client) continue;
      const inst = await getAppInstance(client);
      if (!inst || inst.isFree || purchaseKey(inst) !== s.wixPurchaseKey) {
        await syncWixBilling(instanceId, deps);
        continue;
      }
      const tier = PLAN_TIERS.find((t) => t.id === s.plan);
      if (!tier || tier.credits <= 0) continue;
      const cycle = (s.billingCycle ?? 'monthly') as BillingCycle;
      const dueAt = s.nextCreditRefillAt!;
      await applyCreditTransaction({
        userId: s.userId,
        delta: 0,
        setSubscriptionTo: tier.credits,
        reason: `subscription_${s.plan}_${cycle}_renewal`,
        idempotencyKey: `refill-${s.id}-${dueAt.toISOString()}`,
        metadata: { channel: 'wix', instanceId, purchase: s.wixPurchaseKey }
      });
      let next = nextRefill(dueAt, cycle);
      while (next <= now) next = nextRefill(next, cycle);
      await db
        .update(subscriptions)
        .set({
          nextCreditRefillAt: next,
          lastCreditRefillAt: now,
          currentPeriodEnd: inst.billing?.expirationDate
            ? new Date(inst.billing.expirationDate)
            : s.currentPeriodEnd
        })
        .where(eq(subscriptions.id, s.id));
      refilled++;
    } catch (e) {
      console.error('[wix billing] refill failed', instanceId, e instanceof Error ? e.message : e);
    }
  }
  return refilled;
}
