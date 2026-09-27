/**
 * Wix App Market path: dashboard page session (signed instance → our token),
 * site registry, account creation or linking, Wix Billing (plans, packs,
 * downgrades, test purchases, refills, uninstall) and the web billing guard.
 * Wix's APIs are the in-memory fake below; every decision is re-read from
 * it, as in production.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null)
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
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
const fakeState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/wix-connector/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/features/wix-connector/api/client')>();
  return { ...mod, createWixClient: () => fakeState.current };
});

import { PRICING } from '@/entities/ai-model';
import { applyCreditTransaction } from '@/entities/credit';
import {
  getConnection,
  getWixInstance,
  recordShopifyInstall,
  markShopifyShopLinked,
  signWixSessionToken
} from '@/entities/shop-connection';
import { sessionFromWixToken } from '@/entities/user';
import { POST as webhookPost } from '@/app/api/webhooks/wix/route';
import { buyCreditPackAction, createCheckoutSessionAction } from '@/features/billing/api/actions';
import { createShopLinkToken } from '@/features/shopify-connector';
import {
  createWixLinkToken,
  ensureWixInstall,
  linkWixSiteToUser,
  loadWixEmbeddedState,
  onboardWixSite,
  onWixAppRemoved,
  refillWixSubscriptions,
  signInstance,
  startWixCheckout,
  syncWixBilling,
  wixManageUrlFor,
  wixSessionFromInstance
} from '@/features/wix-connector';
import { db } from '@/shared/db';
import { legalConsents, projects, subscriptions, users } from '@/shared/db/schema';
import { WIX_PUBLIC_KEY_PEM, wixWebhookJwt } from '../unit/wix-fixtures';
import { buckets, createUser, resetTables } from './helpers';
import { createFakeWixClient, setWixEnv, type FakeWixClient } from './wix-helpers';

const INSTANCE = 'inst-aaaa-0001';
const SECRET = 'wix-app-secret-for-tests';
const IDS = {
  starter: 'prod-starter',
  pro: 'prod-pro',
  scale: 'prod-scale',
  boost: 'prod-boost',
  power: 'prod-power',
  mega: 'prod-mega',
  catalog: 'prod-catalog'
};

interface WixWorld {
  isFree: boolean;
  billing: Record<string, unknown> | null;
  ownerEmail: string | null;
  apps: string[];
  purchases: Array<{ productId: string; price: string; billingCycle: string; dateCreated: string }>;
  checkouts: Array<Record<string, unknown>>;
  bi: number;
}
let world: WixWorld;
let fake: FakeWixClient;

function wixClient(): FakeWixClient {
  const c = createFakeWixClient();
  c.request = (async (path: string, init?: { method?: string; body?: unknown }) => {
    if (c.tokenInvalid) throw new Error('token refused');
    if (path === '/apps/v1/instance') {
      return {
        instance: { instanceId: INSTANCE, isFree: world.isFree, billing: world.billing },
        site: {
          siteDisplayName: 'Atelier Wix',
          url: 'https://atelier.wixsite.com/shop',
          locale: 'fr',
          ownerInfo: world.ownerEmail ? { email: world.ownerEmail } : null,
          installedWixApps: world.apps
        }
      };
    }
    if (path === '/apps/v1/checkout') {
      world.checkouts.push(init?.body as Record<string, unknown>);
      return { checkoutUrl: 'https://www.wix.com/checkout/abc' };
    }
    if (path === '/apps/v1/checkout/history') return { purchases: world.purchases };
    if (path === '/apps/v1/bi-event') {
      world.bi++;
      return {};
    }
    throw new Error(`unexpected ${path}`);
  }) as FakeWixClient['request'];
  return c;
}

function buy(productId: string, price: string, billingCycle: string, dateCreated: string) {
  world.purchases.push({ productId, price, billingCycle, dateCreated });
}

function runPlan(plan: keyof typeof IDS, cycle: 'MONTHLY' | 'YEARLY', since: string) {
  world.isFree = false;
  world.billing = {
    packageName: IDS[plan],
    billingCycle: cycle,
    timeStamp: since,
    autoRenewing: true,
    invoiceId: '1'
  };
}

beforeEach(async () => {
  await resetTables();
  setWixEnv(WIX_PUBLIC_KEY_PEM);
  process.env.AUTH_SECRET = 'auth-secret-for-tests';
  delete process.env.WIX_APP_PUBLISHED;
  Object.assign(PRICING.wixBilling.productIds, IDS);
  world = {
    isFree: true,
    billing: null,
    ownerEmail: 'owner@atelier.test',
    apps: ['stores'],
    purchases: [],
    checkouts: [],
    bi: 0
  };
  fake = wixClient();
  fakeState.current = fake;
  session.userId = null;
});
afterAll(async () => {
  await db.$client.end();
});

async function onboarded(): Promise<{ userId: string; projectId: string }> {
  await ensureWixInstall(INSTANCE);
  const res = await onboardWixSite(INSTANCE, { locale: 'fr' });
  if (!res.ok) throw new Error(res.reason);
  return res;
}

async function channel(userId: string) {
  return (await db.query.users.findFirst({ where: eq(users.id, userId) }))?.billingChannel;
}

describe('dashboard page session', () => {
  it('a fresh signed instance becomes our token; stale, forged or foreign ones do not', () => {
    const now = Date.parse('2026-09-27T10:00:00Z');
    const fresh = signInstance({ instanceId: INSTANCE, signDate: '2026-09-27T09:50:00Z' }, SECRET);
    const s = wixSessionFromInstance(fresh, now);
    expect(s?.instanceId).toBe(INSTANCE);
    expect(s?.token.split('.')).toHaveLength(3);
    const stale = signInstance({ instanceId: INSTANCE, signDate: '2026-09-27T08:00:00Z' }, SECRET);
    expect(wixSessionFromInstance(stale, now)).toBeNull();
    expect(wixSessionFromInstance(fresh.replace(/^./, 'x'), now)).toBeNull();
    const other = signInstance({ instanceId: INSTANCE, signDate: '2026-09-27T09:50:00Z' }, 'nope');
    expect(wixSessionFromInstance(other, now)).toBeNull();
    const undated = signInstance({ instanceId: INSTANCE }, SECRET);
    expect(wixSessionFromInstance(undated, now)).toBeNull();
  });

  it('the token is a session only once the site is linked, and only for its own site', async () => {
    const token = signWixSessionToken(INSTANCE, SECRET);
    await ensureWixInstall(INSTANCE);
    expect(await sessionFromWixToken(token)).toBeNull();
    const { userId, projectId } = await onboarded();
    const s = await sessionFromWixToken(token);
    expect(s?.user.id).toBe(userId);
    expect(s?.embedded).toEqual({ host: 'wix', shop: INSTANCE, projectId });
    await onWixAppRemoved(INSTANCE);
    expect(await sessionFromWixToken(token)).toBeNull();
  });
});

describe('install, onboarding and linking', () => {
  it('registers the site from Wix and shows the onboarding with a masked email', async () => {
    const install = await ensureWixInstall(INSTANCE);
    expect(install.row).toMatchObject({
      instanceId: INSTANCE,
      siteName: 'Atelier Wix',
      siteHost: 'atelier.wixsite.com',
      ownerEmail: 'owner@atelier.test',
      userId: null
    });
    const state = await loadWixEmbeddedState(install);
    expect(state).toMatchObject({
      kind: 'onboarding',
      email: 'o••••@atelier.test',
      emailTaken: false,
      storesMissing: false
    });
    world.apps = ['blog'];
    const noStores = await loadWixEmbeddedState(await ensureWixInstall(INSTANCE));
    expect(noStores).toMatchObject({ storesMissing: true });
  });

  it('"Create my workspace": Wix-billed account, welcome credits, consent, site connected', async () => {
    const { userId, projectId } = await onboarded();
    const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(u).toMatchObject({
      email: 'owner@atelier.test',
      billingChannel: 'wix',
      creditsBalance: 150
    });
    expect(
      await db.query.legalConsents.findFirst({ where: eq(legalConsents.userId, userId) })
    ).toMatchObject({ kind: 'signup_tos' });
    const p = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    expect(p).toMatchObject({ source: 'wix', domain: 'atelier.wixsite.com' });
    expect(await getConnection(projectId)).toMatchObject({
      platform: 'wix',
      status: 'connected',
      instanceId: INSTANCE
    });
    expect(await getWixInstance(INSTANCE)).toMatchObject({ userId, projectId });
    expect(world.bi).toBe(1);
    expect(await onboardWixSite(INSTANCE)).toEqual({ ok: false, reason: 'already_linked' });
  });

  it('an existing account links with a Wix link token — never with a Shopify one', async () => {
    world.ownerEmail = 'taken@atelier.test';
    const existing = await createUser();
    await db.update(users).set({ email: 'taken@atelier.test' }).where(eq(users.id, existing));
    await ensureWixInstall(INSTANCE);
    expect(await onboardWixSite(INSTANCE)).toEqual({ ok: false, reason: 'email_taken' });

    expect(await linkWixSiteToUser(createShopLinkToken(INSTANCE), existing)).toEqual({
      ok: false,
      reason: 'bad_token'
    });
    const res = await linkWixSiteToUser(createWixLinkToken(INSTANCE), existing);
    expect(res.ok).toBe(true);
    expect(await channel(existing)).toBe('wix');
    const intruder = await createUser();
    expect(await linkWixSiteToUser(createWixLinkToken(INSTANCE), intruder)).toEqual({
      ok: false,
      reason: 'linked_elsewhere'
    });
  });

  it('a live Stripe plan keeps web billing when linking', async () => {
    const existing = await createUser();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId: existing,
      plan: 'pro',
      status: 'active',
      billingCycle: 'monthly'
    });
    await ensureWixInstall(INSTANCE);
    await linkWixSiteToUser(createWixLinkToken(INSTANCE), existing);
    expect(await channel(existing)).toBe('stripe');
  });

  it('a reinstalled site is reconnected to its account on the next visit', async () => {
    const { userId, projectId } = await onboarded();
    await onWixAppRemoved(INSTANCE);
    const again = await ensureWixInstall(INSTANCE);
    expect(again.row).toMatchObject({ userId, projectId, uninstalledAt: null });
    expect(await channel(userId)).toBe('wix');
  });
});

describe('Wix Billing', () => {
  it('checkout: plan GUID and cycle, back to the dashboard; packs are one-time', async () => {
    await onboarded();
    const res = await startWixCheckout(INSTANCE, { kind: 'plan', plan: 'pro', cycle: 'yearly' });
    expect(res).toEqual({ ok: true, checkoutUrl: 'https://www.wix.com/checkout/abc' });
    expect(world.checkouts[0]).toEqual({
      productId: 'prod-pro',
      billingCycle: 'YEARLY',
      successUrl: `https://www.wix.com/my-account/app/wix-app-id/${INSTANCE}`
    });
    await startWixCheckout(INSTANCE, { kind: 'pack', pack: 'power' });
    expect(world.checkouts[1]).toMatchObject({ productId: 'prod-power', billingCycle: 'ONE_TIME' });
    PRICING.wixBilling.productIds.scale = null;
    expect(
      await startWixCheckout(INSTANCE, { kind: 'plan', plan: 'scale', cycle: 'monthly' })
    ).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('a paid plan fills the subscription bucket once; renewals and re-syncs grant nothing', async () => {
    process.env.WIX_APP_PUBLISHED = '1';
    const { userId } = await onboarded();
    buy(IDS.pro, '131.99', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    runPlan('pro', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    expect(await syncWixBilling(INSTANCE)).toEqual({ plan: 'activated', packsGranted: 0 });
    expect((await buckets(userId)).sub).toBe(15000);
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId)
    });
    expect(sub).toMatchObject({
      channel: 'wix',
      plan: 'pro',
      billingCycle: 'monthly',
      status: 'active',
      wixInstanceId: INSTANCE
    });
    expect(sub?.nextCreditRefillAt).not.toBeNull();
    expect(await syncWixBilling(INSTANCE)).toEqual({ plan: 'unchanged', packsGranted: 0 });
    expect((await buckets(userId)).sub).toBe(15000);
  });

  it('an upgrade adds the difference; a downgrade is refused here (cancel in Wix first)', async () => {
    process.env.WIX_APP_PUBLISHED = '1';
    const { userId } = await onboarded();
    buy(IDS.starter, '58.99', 'MONTHLY', '2026-09-01T10:00:00.000Z');
    runPlan('starter', 'MONTHLY', '2026-09-01T10:00:00.000Z');
    await syncWixBilling(INSTANCE);
    await applyCreditTransaction({ userId, delta: -500, reason: 'spend' });
    buy(IDS.pro, '131.99', 'MONTHLY', '2026-09-10T10:00:00.000Z');
    runPlan('pro', 'MONTHLY', '2026-09-10T10:00:00.000Z');
    await syncWixBilling(INSTANCE);
    expect((await buckets(userId)).sub).toBe(5500 - 500 + (15000 - 5500));
    expect(
      await startWixCheckout(INSTANCE, { kind: 'plan', plan: 'starter', cycle: 'monthly' })
    ).toEqual({ ok: false, reason: 'downgrade' });
    expect(
      await startWixCheckout(INSTANCE, { kind: 'plan', plan: 'pro', cycle: 'monthly' })
    ).toEqual({ ok: false, reason: 'current_plan' });
    expect(
      (await startWixCheckout(INSTANCE, { kind: 'plan', plan: 'pro', cycle: 'yearly' })).ok
    ).toBe(true);
  });

  it('test purchases (0.00 before listing) are capped per account, shared with Shopify', async () => {
    const { userId } = await onboarded();
    await applyCreditTransaction({
      userId,
      delta: 200,
      bucket: 'pack',
      reason: 'shopify_test_grant',
      idempotencyKey: 'shopify-test-1'
    });
    buy(IDS.scale, '0.00', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    runPlan('scale', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    buy(IDS.catalog, '0.00', 'ONE_TIME', '2026-09-27T11:00:00.000Z');
    await syncWixBilling(INSTANCE);
    const b = await buckets(userId);
    expect(b.pack).toBe(150 + 200 + 300);
    expect(b.sub).toBe(0);
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId)
    });
    expect(sub).toMatchObject({ plan: 'scale', nextCreditRefillAt: null });
  });

  it('every pack in the purchase history is credited exactly once', async () => {
    const { userId } = await onboarded();
    buy(IDS.power, '26.99', 'ONE_TIME', '2026-09-27T10:00:00.000Z');
    buy(IDS.power, '26.99', 'ONE_TIME', '2026-09-27T12:00:00.000Z');
    expect((await syncWixBilling(INSTANCE))?.packsGranted).toBe(2);
    expect((await syncWixBilling(INSTANCE))?.packsGranted).toBe(0);
    expect((await buckets(userId)).pack).toBe(150 + 4000);
  });

  it('a plan ended in Wix goes back to free; a second, free Wix site does not end it', async () => {
    process.env.WIX_APP_PUBLISHED = '1';
    const { userId } = await onboarded();
    buy(IDS.pro, '131.99', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    runPlan('pro', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    await syncWixBilling(INSTANCE);
    await db
      .update(subscriptions)
      .set({ wixInstanceId: 'inst-other-site' })
      .where(eq(subscriptions.userId, userId));
    world.isFree = true;
    world.billing = null;
    expect((await syncWixBilling(INSTANCE))?.plan).toBe('unchanged');
    expect((await db.query.users.findFirst({ where: eq(users.id, userId) }))?.plan).toBe('pro');
    await db
      .update(subscriptions)
      .set({ wixInstanceId: INSTANCE })
      .where(eq(subscriptions.userId, userId));
    expect((await syncWixBilling(INSTANCE))?.plan).toBe('canceled');
    expect((await db.query.users.findFirst({ where: eq(users.id, userId) }))?.plan).toBe('free');
  });

  it('monthly refills: due → reset to the allowance while the same purchase runs', async () => {
    process.env.WIX_APP_PUBLISHED = '1';
    const { userId } = await onboarded();
    buy(IDS.starter, '58.99', 'YEARLY', '2026-09-27T10:00:00.000Z');
    runPlan('starter', 'YEARLY', '2026-09-27T10:00:00.000Z');
    await syncWixBilling(INSTANCE);
    await applyCreditTransaction({ userId, delta: -5000, reason: 'spend' });
    const later = new Date(Date.now() + 32 * 86400_000);
    expect(await refillWixSubscriptions({ now: later })).toBe(1);
    expect((await buckets(userId)).sub).toBe(5500);
    expect(await refillWixSubscriptions({ now: later })).toBe(0);
  });

  it('removing the app ends its plan; the account goes back to web billing, or to its Shopify shop', async () => {
    process.env.WIX_APP_PUBLISHED = '1';
    const { userId, projectId } = await onboarded();
    buy(IDS.pro, '131.99', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    runPlan('pro', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    await syncWixBilling(INSTANCE);
    await recordShopifyInstall(
      'atelier.myshopify.com',
      {
        shopName: 'Atelier',
        shopEmail: null,
        primaryDomain: null,
        partnerDevelopment: false,
        scopes: []
      },
      null
    );
    await markShopifyShopLinked('atelier.myshopify.com', userId, projectId);
    await onWixAppRemoved(INSTANCE);
    const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(u).toMatchObject({ plan: 'free', billingChannel: 'shopify' });
    expect((await getWixInstance(INSTANCE))?.uninstalledAt).not.toBeNull();
    expect(await wixManageUrlFor(userId)).toBeNull();
  });

  it('the website never opens Stripe for a Wix-billed account', async () => {
    const { userId } = await onboarded();
    session.userId = userId;
    const plan = new FormData();
    plan.set('plan', 'pro');
    await expect(createCheckoutSessionAction(plan)).rejects.toMatchObject({
      to: '/pricing?error=shopify_billing'
    });
    const pack = new FormData();
    pack.set('pack', 'boost');
    await expect(buyCreditPackAction(pack)).rejects.toMatchObject({
      to: '/account/credits?error=shopify_billing'
    });
    expect(await wixManageUrlFor(userId)).toBe(
      `https://www.wix.com/my-account/app/wix-app-id/${INSTANCE}`
    );
  });
});

describe('POST /api/webhooks/wix — app instance events', () => {
  const post = (jwt: string) =>
    webhookPost(
      new Request('http://localhost:3030/api/webhooks/wix', { method: 'POST', body: jwt })
    );

  it('a paid plan event re-reads Wix; App Removed on an unlinked site uninstalls it', async () => {
    process.env.WIX_APP_PUBLISHED = '1';
    const { userId } = await onboarded();
    buy(IDS.pro, '131.99', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    runPlan('pro', 'MONTHLY', '2026-09-27T10:00:00.000Z');
    const res = await post(wixWebhookJwt({ instanceId: INSTANCE, eventType: 'PaidPlanChanged' }));
    expect(await res.json()).toMatchObject({ ok: true, action: 'billing:activated' });
    expect((await db.query.users.findFirst({ where: eq(users.id, userId) }))?.plan).toBe('pro');

    const other = 'inst-unlinked-0002';
    await db.execute(
      // an App Market install nobody linked yet
      (await import('drizzle-orm')).sql`INSERT INTO wix_instances (instance_id) VALUES (${other})`
    );
    const removed = await post(wixWebhookJwt({ instanceId: other, eventType: 'AppRemoved' }));
    expect(await removed.json()).toMatchObject({ ok: true, action: 'uninstalled' });
    expect((await getWixInstance(other))?.uninstalledAt).not.toBeNull();
  });
});
