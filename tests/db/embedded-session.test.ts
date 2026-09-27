/**
 * Inside the Shopify admin the ID token is the session: `auth()` resolves it to
 * the account the shop is linked to (src/entities/user/api/embedded-session.ts).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ authorization: null as string | null }));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(request.authorization ? { authorization: request.authorization } : {})
}));

import { signShopifyIdTokenForTests } from '@/entities/shop-connection';
// The module itself: the @/entities/user barrel loads next-auth, which vitest cannot.
import { embeddedSession, sessionFromShopifyIdToken } from '@/entities/user/api/embedded-session';
import { db } from '@/shared/db';
import { shopifyShops, users } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';

const SECRET = 'shpss_' + 'e'.repeat(32);
const SHOP = 'atelier.myshopify.com';
const NOW = Math.floor(Date.now() / 1000);
let userId: string;

function token(patch: Record<string, unknown> = {}, secret = SECRET) {
  return signShopifyIdTokenForTests(
    {
      iss: `https://${SHOP}/admin`,
      dest: `https://${SHOP}`,
      aud: 'client-id',
      sub: '1',
      exp: NOW + 60,
      nbf: NOW - 5,
      ...patch
    },
    secret
  );
}

beforeEach(async () => {
  await resetTables();
  process.env.SHOPIFY_APP_CLIENT_ID = 'client-id';
  process.env.SHOPIFY_APP_CLIENT_SECRET = SECRET;
  request.authorization = null;
  userId = await createUser({ pack: 42 });
  await db.update(users).set({ plan: 'pro' }).where(eq(users.id, userId));
  await db.insert(shopifyShops).values({ shopDomain: SHOP, userId, shopName: 'Atelier' });
});
afterAll(async () => {
  delete process.env.SHOPIFY_APP_CLIENT_ID;
  delete process.env.SHOPIFY_APP_CLIENT_SECRET;
  await db.$client.end();
});

describe('sessionFromShopifyIdToken', () => {
  it('is the session of the account the shop is linked to', async () => {
    const session = await sessionFromShopifyIdToken(token(), NOW);
    expect(session?.user).toMatchObject({ id: userId, plan: 'pro', creditsBalance: 42 });
    expect(session?.expires).toBe(new Date((NOW + 60) * 1000).toISOString());
  });

  it('refuses a forged or expired token, an unlinked shop and an uninstalled app', async () => {
    expect(await sessionFromShopifyIdToken(token({}, 'other-secret'), NOW)).toBeNull();
    expect(await sessionFromShopifyIdToken(token({ exp: NOW - 60 }), NOW)).toBeNull();
    await db.update(shopifyShops).set({ uninstalledAt: new Date() });
    expect(await sessionFromShopifyIdToken(token(), NOW)).toBeNull();
    await db.update(shopifyShops).set({ uninstalledAt: null, userId: null });
    expect(await sessionFromShopifyIdToken(token(), NOW)).toBeNull();
  });

  it('is null when the app is not configured', async () => {
    delete process.env.SHOPIFY_APP_CLIENT_SECRET;
    expect(await sessionFromShopifyIdToken(token(), NOW)).toBeNull();
    process.env.SHOPIFY_APP_CLIENT_SECRET = SECRET;
  });
});

describe('embeddedSession', () => {
  it('reads the Bearer token of the current request', async () => {
    request.authorization = `Bearer ${token()}`;
    expect((await embeddedSession())?.user.id).toBe(userId);
  });

  it('is null without a Shopify token (cookie sessions take over)', async () => {
    expect(await embeddedSession()).toBeNull();
    request.authorization = 'Bearer osl_live_sitekey';
    expect(await embeddedSession()).toBeNull();
  });
});
