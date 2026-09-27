/**
 * Shopify App Store path: embedded install (token exchange stubbed), account
 * creation or linking, Shopify Billing (plans, packs, cancel, refills,
 * uninstall) and the web billing guard. Shopify's Admin API is the in-memory
 * fake below; every decision is re-read from it, as in production.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null)
}));
class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  }
}));

import { applyCreditTransaction } from '@/entities/credit';
import { getConnection, getShopifyShop, readShopifyTokenGrant } from '@/entities/shop-connection';
import { POST as appWebhookPost } from '@/app/api/webhooks/shopify/app/route';
import { buyCreditPackAction, createCheckoutSessionAction } from '@/features/billing/api/actions';
import {
  refillStripeYearlySubscriptions,
  scheduleStripeRefill
} from '@/features/billing/api/refill';
import {
  cancelShopifySubscription,
  computeShopifyHmac,
  confirmShopifyReturn,
  createShopLinkToken,
  ensureEmbeddedInstall,
  handleShopifyBillingWebhook,
  linkShopToUser,
  onboardShopifyShop,
  onShopifyAppUninstalled,
  refillShopifySubscriptions,
  shopifyManageUrlFor,
  startShopifyPackPurchase,
  startShopifySubscription,
  type ShopifyAppConfig
} from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { legalConsents, projects, subscriptions, users } from '@/shared/db/schema';
import { buckets, createUser, ledgerSum, resetTables } from './helpers';
import { createFakeClient, TOKEN } from './shopify-helpers';

const SHOP = 'atelier.myshopify.com';
const CFG: ShopifyAppConfig = {
  clientId: 'client-id',
  clientSecret: 'shpss_' + 'q'.repeat(32),
  scopes: ['read_products', 'write_products', 'write_files']
};

interface Sub {
  id: string;
  name: string;
  status: string;
  test: boolean;
  currentPeriodEnd: string | null;
}

let shopify: {
  email: string | null;
  active: Sub[];
  purchases: Map<string, { id: string; name: string; status: string; test: boolean }>;
  created: Array<Record<string, unknown>>;
  cancelled: string[];
};

function handle(query: string, vars: Record<string, unknown> = {}): unknown {
  if (query.includes('OslShopFacts')) {
    return {
      shop: {
        name: 'Atelier',
        email: shopify.email,
        contactEmail: null,
        primaryDomain: { host: 'atelier.fr' },
        plan: { partnerDevelopment: true }
      },
      currentAppInstallation: {
        accessScopes: CFG.scopes.map((handle) => ({ handle }))
      }
    };
  }
  if (query.includes('OslActiveSubscription')) {
    return { currentAppInstallation: { activeSubscriptions: shopify.active } };
  }
  if (query.includes('OslSubscribe')) {
    shopify.created.push(vars);
    return {
      appSubscriptionCreate: {
        confirmationUrl: `https://${SHOP}/admin/charges/confirm_recurring`,
        userErrors: []
      }
    };
  }
  if (query.includes('OslBuyPack')) {
    shopify.created.push(vars);
    return {
      appPurchaseOneTimeCreate: {
        confirmationUrl: `https://${SHOP}/admin/charges/confirm_one_time`,
        userErrors: []
      }
    };
  }
  if (query.includes('OslCancel')) {
    shopify.cancelled.push(String(vars.id));
    shopify.active = [];
    return { appSubscriptionCancel: { userErrors: [] } };
  }
  if (query.includes('OslPurchase')) {
    return { node: shopify.purchases.get(String(vars.id)) ?? null };
  }
  throw new Error(`unexpected query: ${query.slice(0, 60)}`);
}

const makeClient = () => {
  const base = createFakeClient();
  return {
    ...base,
    request: async <T>(q: string, v?: Record<string, unknown>) => handle(q, v) as T
  };
};
const exchangeBodies: URLSearchParams[] = [];
const fetchImpl = (async (_url: string, init?: RequestInit) => {
  exchangeBodies.push(new URLSearchParams(String(init?.body ?? '')));
  return new Response(
    JSON.stringify({
      access_token: TOKEN,
      scope: CFG.scopes.join(','),
      expires_in: 3600,
      refresh_token: 'shprt_' + 'e'.repeat(32),
      refresh_token_expires_in: 7776000
    }),
    { status: 200 }
  );
}) as unknown as typeof fetch;
const deps = { makeClient, fetchImpl };
const auth = { shop: SHOP, idToken: 'id-token', cfg: CFG };

beforeEach(async () => {
  await resetTables();
  process.env.SHOPIFY_APP_CLIENT_ID = CFG.clientId;
  process.env.SHOPIFY_APP_CLIENT_SECRET = CFG.clientSecret;
  process.env.APP_URL = 'https://oneshoplab.test';
  process.env.AUTH_SECRET ??= 'test-auth-secret-'.padEnd(40, 'x');
  session.userId = null;
  shopify = {
    email: 'Owner@Atelier.test',
    active: [],
    purchases: new Map(),
    created: [],
    cancelled: []
  };
});
afterAll(async () => {
  await db.$client.end();
});

async function onboarded(): Promise<{ userId: string; projectId: string }> {
  await ensureEmbeddedInstall(auth, deps);
  const res = await onboardShopifyShop(SHOP, { locale: 'fr', cfg: CFG, ...deps });
  if (!res.ok) throw new Error(`onboard failed: ${res.reason}`);
  return res;
}

async function subRow(userId: string) {
  return db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) });
}

function activeSub(n: number, name: string): Sub {
  return {
    id: `gid://shopify/AppSubscription/${n}`,
    name,
    status: 'ACTIVE',
    test: true,
    currentPeriodEnd: '2026-10-27T00:00:00Z'
  };
}

describe('embedded install and onboarding', () => {
  it('creates a Shopify-billed account with the welcome credits, consent and a connected project', async () => {
    const row = await ensureEmbeddedInstall(auth, deps);
    expect(row.pendingTokenCiphertext).toBeTruthy();
    expect(row.partnerDevelopment).toBe(true);

    const { userId, projectId } = await onboarded();
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(user).toMatchObject({
      email: 'owner@atelier.test',
      billingChannel: 'shopify',
      plan: 'free'
    });
    expect((await buckets(userId)).pack).toBe(150);
    expect(await ledgerSum(userId)).toBe(150);
    const consent = await db.query.legalConsents.findFirst({
      where: eq(legalConsents.userId, userId)
    });
    expect(consent?.kind).toBe('signup_tos');
    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    expect(project?.domain).toBe('atelier.fr');
    expect((await getConnection(projectId))?.status).toBe('connected');
    expect(exchangeBodies.at(-1)?.get('expiring')).toBe('1');
    expect((await readShopifyTokenGrant(projectId))?.refreshToken).toBe('shprt_' + 'e'.repeat(32));
    const linked = await getShopifyShop(SHOP);
    expect(linked).toMatchObject({ userId, projectId });
    expect(linked?.pendingTokenCiphertext).toBeNull();

    expect(await onboardShopifyShop(SHOP, { cfg: CFG, ...deps })).toEqual({
      ok: false,
      reason: 'already_linked'
    });
  });

  it('refuses to create a second account for an email already registered', async () => {
    const existing = await createUser();
    await db.update(users).set({ email: 'owner@atelier.test' }).where(eq(users.id, existing));
    await ensureEmbeddedInstall(auth, deps);
    expect(await onboardShopifyShop(SHOP, { cfg: CFG, ...deps })).toEqual({
      ok: false,
      reason: 'email_taken'
    });
  });

  it('links an existing free account, which then buys through Shopify', async () => {
    const userId = await createUser();
    await ensureEmbeddedInstall(auth, deps);
    const res = await linkShopToUser(createShopLinkToken(SHOP), userId, { cfg: CFG, ...deps });
    expect(res.ok).toBe(true);
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(user?.billingChannel).toBe('shopify');
    expect(await shopifyManageUrlFor(userId)).toBe(`https://${SHOP}/admin/apps/${CFG.clientId}`);

    const other = await createUser();
    expect(await linkShopToUser(createShopLinkToken(SHOP), other, { cfg: CFG, ...deps })).toEqual({
      ok: false,
      reason: 'linked_elsewhere'
    });
  });

  it('keeps a live Stripe plan on the web when its owner links a shop', async () => {
    const userId = await createUser();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId,
      plan: 'pro',
      status: 'active',
      billingCycle: 'monthly'
    });
    await ensureEmbeddedInstall(auth, deps);
    expect(
      (await linkShopToUser(createShopLinkToken(SHOP), userId, { cfg: CFG, ...deps })).ok
    ).toBe(true);
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(user?.billingChannel).toBe('stripe');
    expect(await shopifyManageUrlFor(userId)).toBeNull();
    expect((await startShopifySubscription(SHOP, 'pro', 'monthly', deps)).ok).toBe(false);
  });

  it('rejects a tampered or expired link token', async () => {
    const userId = await createUser();
    await ensureEmbeddedInstall(auth, deps);
    const token = createShopLinkToken(SHOP, Date.now() - 16 * 60 * 1000);
    expect(await linkShopToUser(token, userId, { cfg: CFG, ...deps })).toEqual({
      ok: false,
      reason: 'bad_token'
    });
    expect(
      await linkShopToUser(createShopLinkToken(SHOP) + 'x', userId, { cfg: CFG, ...deps })
    ).toEqual({ ok: false, reason: 'bad_token' });
  });
});

describe('Shopify Billing', () => {
  it('charges the USD price in test mode on development stores', async () => {
    await onboarded();
    const res = await startShopifySubscription(SHOP, 'pro', 'yearly', deps);
    expect(res).toEqual({
      ok: true,
      confirmationUrl: `https://${SHOP}/admin/charges/confirm_recurring`
    });
    const vars = shopify.created[0] as {
      name: string;
      test: boolean;
      returnUrl: string;
      lineItems: Array<{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: number; currencyCode: string };
            interval: string;
          };
        };
      }>;
    };
    expect(vars.name).toBe('OneShopLab Pro (yearly)');
    expect(vars.test).toBe(true);
    expect(vars.returnUrl).toBe(
      `https://oneshoplab.test/api/shopify/billing/return?shop=${encodeURIComponent(SHOP)}&kind=subscription`
    );
    expect(vars.lineItems[0].plan.appRecurringPricingDetails).toEqual({
      price: { amount: 1007.9, currencyCode: 'USD' },
      interval: 'ANNUAL'
    });

    await startShopifyPackPurchase(SHOP, 'power', deps);
    expect(shopify.created[1]).toMatchObject({
      name: 'OneShopLab Power pack (2000 credits)',
      price: { amount: 20.99, currencyCode: 'USD' },
      test: true
    });
  });

  it('grants a first plan once, then only the difference on upgrade', async () => {
    const { userId } = await onboarded();
    shopify.active = [activeSub(1, 'OneShopLab Pro (monthly)')];
    expect(await confirmShopifyReturn(SHOP, 'subscription', null, deps)).toBe('activated');
    expect(await confirmShopifyReturn(SHOP, 'subscription', null, deps)).toBe('unchanged');
    expect(await handleShopifyBillingWebhook(SHOP, 'app_subscriptions/update', '{}', deps)).toBe(
      'unchanged'
    );
    expect(await buckets(userId)).toMatchObject({ sub: 15000, pack: 150 });
    const sub = await subRow(userId);
    expect(sub).toMatchObject({
      channel: 'shopify',
      plan: 'pro',
      billingCycle: 'monthly',
      status: 'active'
    });
    expect(sub?.nextCreditRefillAt).toBeTruthy();
    expect((await db.query.users.findFirst({ where: eq(users.id, userId) }))?.plan).toBe('pro');

    await applyCreditTransaction({
      userId,
      delta: -1000,
      reason: 'spend',
      idempotencyKey: 'spend-1'
    });
    shopify.active = [activeSub(2, 'OneShopLab Scale (monthly)')];
    expect(await confirmShopifyReturn(SHOP, 'subscription', null, deps)).toBe('activated');
    expect((await buckets(userId)).sub).toBe(15000 - 1000 + (38000 - 15000));
    expect(await ledgerSum(userId)).toBe((await buckets(userId)).total);
  });

  it('grants a pack once, whether the return or the webhook comes first', async () => {
    const { userId } = await onboarded();
    const gid = 'gid://shopify/AppPurchaseOneTime/77';
    shopify.purchases.set(gid, {
      id: gid,
      name: 'OneShopLab Power pack (2000 credits)',
      status: 'ACTIVE',
      test: true
    });
    const body = JSON.stringify({ app_purchase_one_time: { admin_graphql_api_id: gid } });
    expect(
      await handleShopifyBillingWebhook(SHOP, 'app_purchases_one_time/update', body, deps)
    ).toBe('granted');
    expect(await confirmShopifyReturn(SHOP, 'pack', '77', deps)).toBe('granted');
    expect((await buckets(userId)).pack).toBe(150 + 2000);

    const declined = 'gid://shopify/AppPurchaseOneTime/78';
    shopify.purchases.set(declined, {
      id: declined,
      name: 'OneShopLab Mega pack (8000 credits)',
      status: 'DECLINED',
      test: true
    });
    expect(await confirmShopifyReturn(SHOP, 'pack', '78', deps)).toBe('not_active');
    expect(await confirmShopifyReturn(SHOP, 'pack', '../x', deps)).toBe('bad_charge');
    expect((await buckets(userId)).pack).toBe(2150);
  });

  it('cancels back to the free plan', async () => {
    const { userId } = await onboarded();
    shopify.active = [activeSub(1, 'OneShopLab Starter (monthly)')];
    await confirmShopifyReturn(SHOP, 'subscription', null, deps);
    expect(await cancelShopifySubscription(SHOP, deps)).toEqual({ ok: true });
    expect(shopify.cancelled).toEqual(['gid://shopify/AppSubscription/1']);
    expect(await subRow(userId)).toMatchObject({
      plan: 'free',
      status: 'canceled',
      nextCreditRefillAt: null
    });
  });

  it('refills the monthly allowance while Shopify still reports the plan active', async () => {
    const { userId } = await onboarded();
    shopify.active = [activeSub(1, 'OneShopLab Pro (yearly)')];
    await confirmShopifyReturn(SHOP, 'subscription', null, deps);
    await applyCreditTransaction({
      userId,
      delta: -9000,
      reason: 'spend',
      idempotencyKey: 'spend-2'
    });
    const due = (await subRow(userId))!.nextCreditRefillAt!;

    expect(await refillShopifySubscriptions({ ...deps, now: new Date(due.getTime() - 1000) })).toBe(
      0
    );
    const at = new Date(due.getTime() + 1000);
    expect(await refillShopifySubscriptions({ ...deps, now: at })).toBe(1);
    expect((await buckets(userId)).sub).toBe(15000);
    expect(await refillShopifySubscriptions({ ...deps, now: at })).toBe(0);
    expect((await subRow(userId))!.nextCreditRefillAt!.getTime()).toBeGreaterThan(at.getTime());

    // Cancelled on Shopify's side without a webhook: the refill notices.
    shopify.active = [];
    await db
      .update(subscriptions)
      .set({ nextCreditRefillAt: new Date(at.getTime() - 1) })
      .where(eq(subscriptions.userId, userId));
    await applyCreditTransaction({
      userId,
      delta: -500,
      reason: 'spend',
      idempotencyKey: 'spend-3'
    });
    await refillShopifySubscriptions({ ...deps, now: at });
    expect((await buckets(userId)).sub).toBe(14500);
    expect((await subRow(userId))?.plan).toBe('free');
  });

  it('ends the plan and hands the account back to web billing on uninstall', async () => {
    const { userId } = await onboarded();
    shopify.active = [activeSub(1, 'OneShopLab Pro (monthly)')];
    await confirmShopifyReturn(SHOP, 'subscription', null, deps);
    await onShopifyAppUninstalled(SHOP);
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(user).toMatchObject({ plan: 'free', billingChannel: 'stripe' });
    expect(await subRow(userId)).toMatchObject({ plan: 'free', status: 'canceled' });
    expect((await getShopifyShop(SHOP))?.uninstalledAt).toBeTruthy();
    expect(await shopifyManageUrlFor(userId)).toBeNull();
  });
});

describe('app-level webhooks', () => {
  function post(topic: string, body: unknown, secret = CFG.clientSecret) {
    const raw = JSON.stringify(body);
    return appWebhookPost(
      new Request('https://oneshoplab.test/api/webhooks/shopify/app', {
        method: 'POST',
        body: raw,
        headers: {
          'x-shopify-topic': topic,
          'x-shopify-shop-domain': SHOP,
          'x-shopify-hmac-sha256': computeShopifyHmac(raw, secret)
        }
      })
    );
  }

  it('refuses a body not signed with the client secret', async () => {
    expect((await post('app/uninstalled', {}, 'wrong')).status).toBe(401);
  });

  it('records the uninstall of a shop that never linked an account', async () => {
    await ensureEmbeddedInstall(auth, deps);
    expect((await post('app/uninstalled', { id: 1 })).status).toBe(200);
    const row = await getShopifyShop(SHOP);
    expect(row?.uninstalledAt).toBeTruthy();
    expect(row?.pendingTokenCiphertext).toBeNull();
  });

  it('revokes the connection and ends the plan of a linked shop', async () => {
    const { userId, projectId } = await onboarded();
    shopify.active = [activeSub(1, 'OneShopLab Pro (monthly)')];
    await confirmShopifyReturn(SHOP, 'subscription', null, deps);
    expect((await post('app/uninstalled', { id: 1 })).status).toBe(200);
    expect((await getConnection(projectId))?.status).not.toBe('connected');
    expect((await db.query.users.findFirst({ where: eq(users.id, userId) }))?.plan).toBe('free');
  });
});

describe('web billing guard', () => {
  it('sends Shopify-billed merchants back instead of opening Stripe', async () => {
    const { userId } = await onboarded();
    session.userId = userId;
    const plan = new FormData();
    plan.set('plan', 'pro');
    plan.set('cycle', 'monthly');
    await expect(createCheckoutSessionAction(plan)).rejects.toMatchObject({
      to: '/pricing?error=shopify_billing'
    });
    const pack = new FormData();
    pack.set('packId', 'power');
    await expect(buyCreditPackAction(pack)).rejects.toMatchObject({
      to: '/account/credits?error=shopify_billing'
    });
  });
});

describe('Stripe yearly monthly refills', () => {
  it('refills every month while the year is paid, then stops', async () => {
    const userId = await createUser();
    const granted = new Date('2026-01-31T09:00:00Z');
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId,
      plan: 'pro',
      status: 'active',
      billingCycle: 'yearly',
      currentPeriodEnd: new Date('2027-01-31T09:00:00Z')
    });
    await applyCreditTransaction({
      userId,
      delta: 0,
      setSubscriptionTo: 15000,
      reason: 'subscription_pro_yearly_grant',
      idempotencyKey: 'grant-y'
    });
    await scheduleStripeRefill(userId, 'yearly', granted);
    expect((await subRow(userId))?.nextCreditRefillAt?.toISOString()).toBe(
      '2026-02-28T09:00:00.000Z'
    );

    await applyCreditTransaction({ userId, delta: -4000, reason: 'spend', idempotencyKey: 's-y' });
    const at = new Date('2026-02-28T10:00:00Z');
    expect(await refillStripeYearlySubscriptions(at)).toBe(1);
    expect(await refillStripeYearlySubscriptions(at)).toBe(0);
    expect((await buckets(userId)).sub).toBe(15000);
    expect((await subRow(userId))?.nextCreditRefillAt?.toISOString()).toBe(
      '2026-03-28T09:00:00.000Z'
    );
    expect(await ledgerSum(userId)).toBe((await buckets(userId)).total);

    await db
      .update(subscriptions)
      .set({ status: 'canceled' })
      .where(eq(subscriptions.userId, userId));
    expect(await refillStripeYearlySubscriptions(new Date('2026-04-01T00:00:00Z'))).toBe(0);
    expect((await subRow(userId))?.nextCreditRefillAt).toBeNull();
  });

  it('leaves monthly Stripe plans to their own invoices', async () => {
    const userId = await createUser();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId,
      plan: 'starter',
      status: 'active',
      billingCycle: 'monthly'
    });
    await scheduleStripeRefill(userId, 'monthly', new Date());
    expect((await subRow(userId))?.nextCreditRefillAt).toBeNull();
  });
});
