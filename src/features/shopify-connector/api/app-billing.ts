/**
 * Shopify Billing for merchants who came through the Shopify admin (App Store
 * requirement 1.2.1: no off-platform billing for them). Same plans, same
 * packs, same credit rules as Stripe — only the till changes:
 *
 * - a plan is an AppSubscription (EVERY_30_DAYS or ANNUAL) the merchant
 *   approves in Shopify; its name (`OneShopLab Pro (yearly)`) is how we read
 *   it back;
 * - a pack is an AppPurchaseOneTime;
 * - Shopify announces no per-cycle payment, so monthly credit refills are
 *   scheduled (`nextCreditRefillAt`) and checked against Shopify before
 *   granting.
 *
 * Shopify is the source of truth: return URLs and webhooks only tell us to
 * look, every decision re-reads the charge from the Admin API.
 */
import { and, eq, isNotNull, lte, sum } from 'drizzle-orm';
import {
  CREDIT_PACKS,
  getCreditPack,
  parseShopifyPlanChargeName,
  PLAN_TIERS,
  SHOPIFY_BILLING_CURRENCY,
  SHOPIFY_TEST_CREDIT_CAP,
  shopifyPackPrice,
  shopifyPlanChargeName,
  shopifyPlanPrice,
  type BillingCycle,
  type CreditPackId,
  type PlanId
} from '@/entities/ai-model';
import { applyCreditTransaction, nextRefill } from '@/entities/credit';
import {
  getShopifyShop,
  installedShopifyShopsFor,
  markShopifyShopUninstalled,
  openPendingGrant,
  withDecryptedToken
} from '@/entities/shop-connection';
import { db } from '@/shared/db';
import { creditTransactions, subscriptions, users } from '@/shared/db/schema';
import { createAdminClient, ShopifyAdminError, type ShopifyAdminClient } from './admin-client';
import { shopifyTokenProvider } from './token';

type PaidPlan = Exclude<PlanId, 'free'>;

/**
 * An account that installs the app — from the admin or from the website's
 * "connect my store" — buys through Shopify from now on (App Store 1.2.1),
 * except a live Stripe plan, which keeps running on the web until it ends.
 */
export async function adoptShopifyBilling(userId: string): Promise<void> {
  const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) });
  const liveStripe =
    !!sub && sub.channel === 'stripe' && sub.plan !== 'free' && sub.status !== 'canceled';
  if (liveStripe) return;
  await db.update(users).set({ billingChannel: 'shopify' }).where(eq(users.id, userId));
}

export interface BillingDeps {
  makeClient?: typeof createAdminClient;
  now?: Date;
}

export interface ShopifyAppSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  currentPeriodEnd: string | null;
}

interface UserError {
  field: string[] | null;
  message: string;
}

function appUrl(): string {
  return (process.env.APP_URL ?? '').replace(/\/+$/, '');
}

/** The embedded app inside the merchant's admin — where every flow ends. */
export function embeddedAppUrl(shop: string): string {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID?.trim() ?? '';
  return `https://${shop}/admin/apps/${clientId}`;
}

export function packChargeName(pack: CreditPackId): string {
  const p = getCreditPack(pack)!;
  return `OneShopLab ${p.name} pack (${p.credits} credits)`;
}

export function parsePackChargeName(name: string): CreditPackId | null {
  const m = /^OneShopLab (\w+) pack \(/.exec(name.trim());
  if (!m) return null;
  return CREDIT_PACKS.find((p) => p.name.toLowerCase() === m[1].toLowerCase())?.id ?? null;
}

async function withShopClient<T>(
  shop: string,
  fn: (client: ShopifyAdminClient) => Promise<T>,
  deps: BillingDeps
): Promise<T | null> {
  const make = deps.makeClient ?? createAdminClient;
  const row = await getShopifyShop(shop);
  if (!row || row.uninstalledAt) return null;
  const projectId = row.projectId;
  if (projectId) {
    const viaConnection = await withDecryptedToken(projectId, (secrets) =>
      fn(
        make({
          shopDomain: secrets.shopDomain,
          accessToken: secrets.accessToken,
          tokenProvider: shopifyTokenProvider(projectId, secrets),
          apiVersion: secrets.apiVersion
        })
      )
    );
    if (viaConnection !== null) return viaConnection;
  }
  const pending = openPendingGrant(row);
  return pending ? fn(make({ shopDomain: shop, accessToken: pending.accessToken })) : null;
}

function assertNoErrors(errors: UserError[] | undefined, op: string): void {
  if (errors && errors.length) {
    throw new ShopifyAdminError(
      'user_errors',
      `${op}: ${errors.map((e) => `${(e.field ?? []).join('.') || '-'}: ${e.message}`).join('; ')}`
    );
  }
}

export async function activeShopifySubscription(
  client: ShopifyAdminClient
): Promise<ShopifyAppSubscription | null> {
  const data = await client.request<{
    currentAppInstallation: { activeSubscriptions: ShopifyAppSubscription[] } | null;
  }>(`query OslActiveSubscription {
  currentAppInstallation { activeSubscriptions { id name status test currentPeriodEnd } }
}`);
  const subs = data.currentAppInstallation?.activeSubscriptions ?? [];
  return subs.find((s) => s.status === 'ACTIVE') ?? null;
}

async function ownerOf(shop: string) {
  const row = await getShopifyShop(shop);
  if (!row?.userId) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  return user ? { row, user } : null;
}

// ------------------------------------------------------------------ starting a charge

export type StartChargeResult =
  | { ok: true; confirmationUrl: string }
  | {
      ok: false;
      reason: 'not_linked' | 'not_shopify_billing' | 'unreachable' | 'rejected';
      error?: string;
    };

export async function startShopifySubscription(
  shop: string,
  plan: PaidPlan,
  cycle: BillingCycle,
  deps: BillingDeps = {}
): Promise<StartChargeResult> {
  const owner = await ownerOf(shop);
  if (!owner) return { ok: false, reason: 'not_linked' };
  if (owner.user.billingChannel !== 'shopify') return { ok: false, reason: 'not_shopify_billing' };
  try {
    const url = await withShopClient(
      shop,
      async (client) => {
        const data = await client.request<{
          appSubscriptionCreate: { confirmationUrl: string | null; userErrors: UserError[] };
        }>(
          `mutation OslSubscribe($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
  appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
    confirmationUrl
    userErrors { field message }
  }
}`,
          {
            name: shopifyPlanChargeName(plan, cycle),
            returnUrl: `${appUrl()}/api/shopify/billing/return?shop=${encodeURIComponent(shop)}&kind=subscription`,
            test: owner.row.partnerDevelopment,
            lineItems: [
              {
                plan: {
                  appRecurringPricingDetails: {
                    price: {
                      amount: shopifyPlanPrice(plan, cycle),
                      currencyCode: SHOPIFY_BILLING_CURRENCY
                    },
                    interval: cycle === 'yearly' ? 'ANNUAL' : 'EVERY_30_DAYS'
                  }
                }
              }
            ]
          }
        );
        assertNoErrors(data.appSubscriptionCreate.userErrors, 'appSubscriptionCreate');
        return data.appSubscriptionCreate.confirmationUrl;
      },
      deps
    );
    return url ? { ok: true, confirmationUrl: url } : { ok: false, reason: 'unreachable' };
  } catch (e) {
    return { ok: false, reason: 'rejected', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function startShopifyPackPurchase(
  shop: string,
  pack: CreditPackId,
  deps: BillingDeps = {}
): Promise<StartChargeResult> {
  const owner = await ownerOf(shop);
  if (!owner) return { ok: false, reason: 'not_linked' };
  if (owner.user.billingChannel !== 'shopify') return { ok: false, reason: 'not_shopify_billing' };
  try {
    const url = await withShopClient(
      shop,
      async (client) => {
        const data = await client.request<{
          appPurchaseOneTimeCreate: { confirmationUrl: string | null; userErrors: UserError[] };
        }>(
          `mutation OslBuyPack($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean) {
  appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
    confirmationUrl
    userErrors { field message }
  }
}`,
          {
            name: packChargeName(pack),
            price: { amount: shopifyPackPrice(pack), currencyCode: SHOPIFY_BILLING_CURRENCY },
            returnUrl: `${appUrl()}/api/shopify/billing/return?shop=${encodeURIComponent(shop)}&kind=pack`,
            test: owner.row.partnerDevelopment
          }
        );
        assertNoErrors(data.appPurchaseOneTimeCreate.userErrors, 'appPurchaseOneTimeCreate');
        return data.appPurchaseOneTimeCreate.confirmationUrl;
      },
      deps
    );
    return url ? { ok: true, confirmationUrl: url } : { ok: false, reason: 'unreachable' };
  } catch (e) {
    return { ok: false, reason: 'rejected', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Back to the free plan, from the embedded app (requirement 1.2.3). */
export async function cancelShopifySubscription(
  shop: string,
  deps: BillingDeps = {}
): Promise<{ ok: boolean; error?: string }> {
  const owner = await ownerOf(shop);
  if (!owner || owner.user.billingChannel !== 'shopify')
    return { ok: false, error: 'not_shopify_billing' };
  try {
    await withShopClient(
      shop,
      async (client) => {
        const active = await activeShopifySubscription(client);
        if (active) {
          const data = await client.request<{ appSubscriptionCancel: { userErrors: UserError[] } }>(
            `mutation OslCancel($id: ID!) { appSubscriptionCancel(id: $id) { userErrors { field message } } }`,
            { id: active.id }
          );
          assertNoErrors(data.appSubscriptionCancel.userErrors, 'appSubscriptionCancel');
        }
      },
      deps
    );
    await applyShopifySubscription(shop, null, deps);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------ test charges

const TEST_GRANT_REASON = 'shopify_test_grant';

/**
 * Development stores can only pay in test mode, so a test charge proves the
 * flow, not a payment. It activates the plan or pack, but its credits are
 * capped per account (`shopifyBilling.testCreditCap`) and never refilled.
 * Otherwise any Shopify partner would get plans and packs for free. The
 * embedded app says so, and so do the review instructions.
 */
async function grantTestCredits(
  userId: string,
  requested: number,
  idempotencyKey: string,
  metadata: Record<string, unknown>
): Promise<number> {
  const [row] = await db
    .select({ s: sum(creditTransactions.delta) })
    .from(creditTransactions)
    .where(
      and(eq(creditTransactions.userId, userId), eq(creditTransactions.reason, TEST_GRANT_REASON))
    );
  const already = Number(row?.s ?? 0);
  const amount = Math.min(requested, Math.max(0, SHOPIFY_TEST_CREDIT_CAP - already));
  if (amount <= 0) return 0;
  await applyCreditTransaction({
    userId,
    delta: amount,
    bucket: 'pack',
    reason: TEST_GRANT_REASON,
    idempotencyKey,
    metadata: { ...metadata, requested, test: true }
  });
  return amount;
}

// ------------------------------------------------------------------ applying what Shopify says

export type BillingApplyOutcome =
  'no_owner' | 'not_shopify_billing' | 'canceled' | 'unknown_plan' | 'activated' | 'unchanged';

/**
 * Mirrors the merchant's Shopify subscription (or its absence) into our
 * `subscriptions` row, the user's plan and their credits. Credit rules are
 * Stripe's: a first paid plan fills the subscription bucket; an upgrade adds
 * only the difference; a downgrade adds nothing now.
 */
export async function applyShopifySubscription(
  shop: string,
  sub: ShopifyAppSubscription | null,
  deps: BillingDeps = {}
): Promise<BillingApplyOutcome> {
  const owner = await ownerOf(shop);
  if (!owner) return 'no_owner';
  if (owner.user.billingChannel !== 'shopify') return 'not_shopify_billing';
  const now = deps.now ?? new Date();
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, owner.user.id)
  });

  if (!sub || sub.status !== 'ACTIVE') {
    if (existing && existing.channel === 'shopify') {
      await db
        .update(subscriptions)
        .set({ plan: 'free', status: 'canceled', nextCreditRefillAt: null })
        .where(eq(subscriptions.userId, owner.user.id));
    }
    await db.update(users).set({ plan: 'free' }).where(eq(users.id, owner.user.id));
    return 'canceled';
  }

  const parsed = parseShopifyPlanChargeName(sub.name);
  if (!parsed) return 'unknown_plan';
  const tier = PLAN_TIERS.find((t) => t.id === parsed.plan)!;
  const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const isNew = !existing || existing.shopifySubscriptionGid !== sub.id;
  const previousPaid =
    existing &&
    existing.channel === 'shopify' &&
    existing.status === 'active' &&
    existing.plan !== 'free'
      ? (PLAN_TIERS.find((t) => t.id === existing.plan) ?? null)
      : null;

  const values = {
    channel: 'shopify' as const,
    plan: parsed.plan,
    billingCycle: parsed.cycle,
    status: 'active',
    currentPeriodEnd: periodEnd,
    shopifySubscriptionGid: sub.id,
    shopifyShopDomain: shop,
    // Test charges are never refilled (see grantTestCredits).
    ...(isNew ? { nextCreditRefillAt: sub.test ? null : nextRefill(now, parsed.cycle) } : {})
  };
  if (existing) {
    await db.update(subscriptions).set(values).where(eq(subscriptions.userId, owner.user.id));
  } else {
    await db
      .insert(subscriptions)
      .values({ id: crypto.randomUUID(), userId: owner.user.id, ...values });
  }
  await db.update(users).set({ plan: parsed.plan }).where(eq(users.id, owner.user.id));

  if (!isNew) return 'unchanged';
  const idempotencyKey = `shopify-sub-${sub.id}`;
  if (sub.test) {
    const requested = previousPaid
      ? Math.max(0, tier.credits - previousPaid.credits)
      : tier.credits;
    await grantTestCredits(owner.user.id, requested, idempotencyKey, {
      channel: 'shopify',
      shop,
      subscriptionGid: sub.id,
      plan: parsed.plan
    });
    return 'activated';
  }
  if (!previousPaid) {
    await applyCreditTransaction({
      userId: owner.user.id,
      delta: 0,
      setSubscriptionTo: tier.credits,
      reason: `subscription_${parsed.plan}_${parsed.cycle}_grant`,
      idempotencyKey,
      metadata: { channel: 'shopify', shop, subscriptionGid: sub.id, test: sub.test }
    });
  } else {
    const delta = tier.credits - previousPaid.credits;
    if (delta > 0) {
      await applyCreditTransaction({
        userId: owner.user.id,
        delta,
        bucket: 'subscription',
        reason: `subscription_${previousPaid.id}_to_${parsed.plan}_upgrade_delta`,
        idempotencyKey,
        metadata: { channel: 'shopify', shop, subscriptionGid: sub.id }
      });
    }
  }
  return 'activated';
}

export async function grantShopifyPack(
  shop: string,
  purchase: { id: string; name: string; status: string; test?: boolean }
): Promise<'granted' | 'not_active' | 'unknown_pack' | 'no_owner'> {
  if (purchase.status !== 'ACTIVE') return 'not_active';
  const packId = parsePackChargeName(purchase.name);
  const pack = packId ? getCreditPack(packId) : null;
  if (!pack) return 'unknown_pack';
  const owner = await ownerOf(shop);
  if (!owner) return 'no_owner';
  if (purchase.test) {
    await grantTestCredits(owner.user.id, pack.credits, `shopify-pack-${purchase.id}`, {
      channel: 'shopify',
      shop,
      purchaseGid: purchase.id,
      packId: pack.id
    });
    return 'granted';
  }
  await applyCreditTransaction({
    userId: owner.user.id,
    delta: pack.credits,
    bucket: 'pack',
    reason: `pack_${pack.id}_purchase`,
    idempotencyKey: `shopify-pack-${purchase.id}`,
    metadata: {
      channel: 'shopify',
      shop,
      purchaseGid: purchase.id,
      packId: pack.id,
      test: purchase.test ?? false
    }
  });
  return 'granted';
}

async function purchaseById(client: ShopifyAdminClient, gid: string) {
  const data = await client.request<{
    node: { id: string; name: string; status: string; test: boolean } | null;
  }>(
    `query OslPurchase($id: ID!) { node(id: $id) { ... on AppPurchaseOneTime { id name status test } } }`,
    {
      id: gid
    }
  );
  return data.node && data.node.id ? data.node : null;
}

/** The merchant approved (or declined) in Shopify and came back to us. */
export async function confirmShopifyReturn(
  shop: string,
  kind: 'subscription' | 'pack',
  chargeId: string | null,
  deps: BillingDeps = {}
): Promise<string> {
  const outcome = await withShopClient(
    shop,
    async (client) => {
      if (kind === 'subscription') {
        return applyShopifySubscription(shop, await activeShopifySubscription(client), deps);
      }
      if (!chargeId || !/^\d+$/.test(chargeId)) return 'bad_charge';
      const purchase = await purchaseById(client, `gid://shopify/AppPurchaseOneTime/${chargeId}`);
      return purchase ? grantShopifyPack(shop, purchase) : 'not_found';
    },
    deps
  );
  return outcome ?? 'not_installed';
}

/** `app_subscriptions/update` and `app_purchases_one_time/update`. */
export async function handleShopifyBillingWebhook(
  shop: string,
  topic: string,
  rawBody: string,
  deps: BillingDeps = {}
): Promise<string> {
  if (topic === 'app_subscriptions/update') {
    const outcome = await withShopClient(
      shop,
      async (client) =>
        applyShopifySubscription(shop, await activeShopifySubscription(client), deps),
      deps
    );
    return outcome ?? 'not_installed';
  }
  if (topic === 'app_purchases_one_time/update') {
    let gid: string | null = null;
    try {
      const body = JSON.parse(rawBody) as {
        app_purchase_one_time?: { admin_graphql_api_id?: string };
      };
      gid = body.app_purchase_one_time?.admin_graphql_api_id ?? null;
    } catch {
      gid = null;
    }
    if (!gid) return 'ignored';
    const outcome = await withShopClient(
      shop,
      async (client) => {
        const purchase = await purchaseById(client, gid!);
        return purchase ? grantShopifyPack(shop, purchase) : 'not_found';
      },
      deps
    );
    return outcome ?? 'not_installed';
  }
  return 'ignored';
}

/** Uninstalling ends the Shopify subscription on Shopify's side; mirror it. */
export async function onShopifyAppUninstalled(shop: string): Promise<void> {
  const owner = await ownerOf(shop);
  await markShopifyShopUninstalled(shop);
  if (!owner || owner.user.billingChannel !== 'shopify') return;
  // Shopify cancels the app's charges on uninstall; only the plan billed on
  // this shop ends here.
  const [ended] = await db
    .update(subscriptions)
    .set({ plan: 'free', status: 'canceled', nextCreditRefillAt: null })
    .where(
      and(
        eq(subscriptions.userId, owner.user.id),
        eq(subscriptions.channel, 'shopify'),
        eq(subscriptions.shopifyShopDomain, shop)
      )
    );
  if (ended.affectedRows > 0) {
    await db.update(users).set({ plan: 'free' }).where(eq(users.id, owner.user.id));
  }
  // No installed shop left: the account is a plain web account again.
  if ((await installedShopifyShopsFor(owner.user.id)).length === 0) {
    await db.update(users).set({ billingChannel: 'stripe' }).where(eq(users.id, owner.user.id));
  }
}

/**
 * Where a Shopify-billed merchant manages plan and packs from the website:
 * the embedded app of one of their installed shops. Null for web billing.
 */
export async function shopifyManageUrlFor(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { billingChannel: true }
  });
  if (user?.billingChannel !== 'shopify') return null;
  const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) });
  const shops = await installedShopifyShopsFor(userId);
  const shop = shops.find((s) => s.shopDomain === sub?.shopifyShopDomain) ?? shops[0] ?? null;
  return shop ? embeddedAppUrl(shop.shopDomain) : null;
}

/**
 * Where plan and packs are managed for this merchant, or null for web
 * billing. Inside the admin it is always the embedded home (same frame): no
 * Stripe screen may open there (App Store requirement 1.2.1).
 */
export async function shopifyBillingLink(
  userId: string,
  embedded: boolean
): Promise<string | null> {
  if (embedded) return '/shopify';
  return shopifyManageUrlFor(userId);
}

// ------------------------------------------------------------------ monthly refills

/**
 * Worker tick. For each Shopify-billed plan whose refill is due, asks Shopify
 * whether the subscription is still active, then resets the subscription
 * bucket to the plan's monthly allowance (use-it-or-lose-it, as on Stripe).
 */
export async function refillShopifySubscriptions(deps: BillingDeps = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const due = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.channel, 'shopify'),
        eq(subscriptions.status, 'active'),
        isNotNull(subscriptions.nextCreditRefillAt),
        lte(subscriptions.nextCreditRefillAt, now)
      )
    )
    .limit(50);
  let refilled = 0;
  for (const s of due) {
    const shop = s.shopifyShopDomain;
    if (!shop) continue;
    try {
      const active = await withShopClient(
        shop,
        (client) => activeShopifySubscription(client),
        deps
      );
      if (!active || active.id !== s.shopifySubscriptionGid) {
        await applyShopifySubscription(shop, active, deps);
        continue;
      }
      if (active.test) {
        await db
          .update(subscriptions)
          .set({ nextCreditRefillAt: null })
          .where(eq(subscriptions.id, s.id));
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
        metadata: { channel: 'shopify', shop, subscriptionGid: s.shopifySubscriptionGid }
      });
      let next = nextRefill(dueAt, cycle);
      while (next <= now) next = nextRefill(next, cycle);
      await db
        .update(subscriptions)
        .set({
          nextCreditRefillAt: next,
          lastCreditRefillAt: now,
          currentPeriodEnd: active.currentPeriodEnd
            ? new Date(active.currentPeriodEnd)
            : s.currentPeriodEnd
        })
        .where(eq(subscriptions.id, s.id));
      refilled++;
    } catch (e) {
      console.error('[shopify billing] refill failed', shop, e instanceof Error ? e.message : e);
    }
  }
  return refilled;
}
