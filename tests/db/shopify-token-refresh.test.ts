/**
 * Expiring offline tokens: the provider handed to every Admin API client
 * refreshes a token about to expire, stores the rotated refresh token, lets a
 * single process refresh a store, and reports a dead refresh token as
 * `token_invalid`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimShopifyTokenRefresh,
  connectShopify,
  readShopifyTokenGrant,
  saveShopifyTokenGrant,
  withDecryptedToken,
  type DecryptedSecrets
} from '@/entities/shop-connection';
import {
  parseShopifyTokenResponse,
  shopifyTokenProvider,
  ShopifyAdminError
} from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';
import { TOKEN } from './shopify-helpers';

const SHOP = 'atelier.myshopify.com';
const SECRET = 'shpss_' + 's'.repeat(32);
const REFRESH = 'shprt_' + 'a'.repeat(32);
const NOW = Date.parse('2026-09-27T10:00:00Z');
let projectId: string;

beforeEach(async () => {
  await resetTables();
  process.env.SHOPIFY_APP_CLIENT_ID = 'client-id';
  process.env.SHOPIFY_APP_CLIENT_SECRET = SECRET;
  const userId = await createUser();
  projectId = await createProject(userId);
  const saved = await connectShopify({
    projectId,
    userId,
    shopDomain: SHOP,
    accessToken: TOKEN,
    apiSecret: SECRET,
    apiVersion: '2025-07',
    authMode: 'oauth',
    refreshToken: REFRESH,
    accessTokenExpiresAt: new Date(NOW + 2 * 60_000),
    refreshTokenExpiresAt: new Date(NOW + 80 * 86400_000)
  });
  if (!saved.ok) throw new Error(saved.reason);
});
afterAll(async () => {
  await db.$client.end();
});

async function secrets(): Promise<DecryptedSecrets> {
  return (await withDecryptedToken(projectId, async (s) => s))!;
}

function refreshStub(responses: Array<{ status: number; body?: unknown }>) {
  const calls: URLSearchParams[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.push(new URLSearchParams(String(init?.body ?? '')));
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(r.body ? JSON.stringify(r.body) : '{"error":"invalid_request"}', {
      status: r.status
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const rotated = (n: number) => ({
  access_token: `shpat_new_${n}_`.padEnd(38, 'x'),
  expires_in: 3600,
  refresh_token: `shprt_new_${n}_`.padEnd(38, 'y'),
  refresh_token_expires_in: 7776000,
  scope: 'read_products,write_products'
});

describe('parseShopifyTokenResponse', () => {
  it('turns lifetimes into dates and keeps a non-expiring token open-ended', () => {
    expect(parseShopifyTokenResponse(rotated(1), NOW)?.grant).toEqual({
      accessToken: rotated(1).access_token,
      refreshToken: rotated(1).refresh_token,
      expiresAt: new Date(NOW + 3600_000),
      refreshExpiresAt: new Date(NOW + 7776000_000)
    });
    expect(parseShopifyTokenResponse({ access_token: TOKEN }, NOW)?.grant).toEqual({
      accessToken: TOKEN,
      refreshToken: null,
      expiresAt: null,
      refreshExpiresAt: null
    });
    expect(parseShopifyTokenResponse({}, NOW)).toBeNull();
  });
});

describe('shopifyTokenProvider', () => {
  it('keeps a token with more than five minutes left', async () => {
    await saveShopifyTokenGrant(projectId, {
      accessToken: TOKEN,
      refreshToken: REFRESH,
      expiresAt: new Date(NOW + 30 * 60_000),
      refreshExpiresAt: null
    });
    const { calls, fetchImpl } = refreshStub([{ status: 200, body: rotated(1) }]);
    const get = shopifyTokenProvider(projectId, await secrets(), { fetchImpl, now: () => NOW });
    expect(await get()).toBe(TOKEN);
    expect(calls).toHaveLength(0);
  });

  it('refreshes a token about to expire and stores the rotated refresh token', async () => {
    const { calls, fetchImpl } = refreshStub([
      { status: 200, body: rotated(1) },
      { status: 200, body: rotated(2) }
    ]);
    const get = shopifyTokenProvider(projectId, await secrets(), { fetchImpl, now: () => NOW });
    expect(await get()).toBe(rotated(1).access_token);
    expect(await get()).toBe(rotated(1).access_token);
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(calls[0])).toEqual({
      client_id: 'client-id',
      client_secret: SECRET,
      grant_type: 'refresh_token',
      refresh_token: REFRESH
    });
    const stored = await readShopifyTokenGrant(projectId);
    expect(stored).toMatchObject({
      accessToken: rotated(1).access_token,
      refreshToken: rotated(1).refresh_token,
      expiresAt: new Date(NOW + 3600_000)
    });

    // An hour later the next provider refreshes from the rotated token.
    const later = NOW + 3600_000;
    const next = shopifyTokenProvider(projectId, await secrets(), { fetchImpl, now: () => later });
    expect(await next()).toBe(rotated(2).access_token);
    expect(calls[1].get('refresh_token')).toBe(rotated(1).refresh_token);
  });

  it('waits for another process that holds the refresh lock instead of refreshing twice', async () => {
    expect(await claimShopifyTokenRefresh(projectId, new Date(NOW))).toBe(true);
    const { calls, fetchImpl } = refreshStub([{ status: 200, body: rotated(9) }]);
    let slept = 0;
    const get = shopifyTokenProvider(projectId, await secrets(), {
      fetchImpl,
      now: () => NOW,
      sleep: async () => {
        // The other process finishes during our first wait.
        if (slept++ === 0) {
          await saveShopifyTokenGrant(projectId, {
            accessToken: rotated(5).access_token,
            refreshToken: rotated(5).refresh_token,
            expiresAt: new Date(NOW + 3600_000),
            refreshExpiresAt: new Date(NOW + 7776000_000)
          });
        }
      }
    });
    expect(await get()).toBe(rotated(5).access_token);
    expect(calls).toHaveLength(0);
  });

  it('reports a dead refresh token as token_invalid and frees the lock', async () => {
    const { fetchImpl } = refreshStub([{ status: 401 }]);
    const get = shopifyTokenProvider(projectId, await secrets(), { fetchImpl, now: () => NOW });
    await expect(get()).rejects.toMatchObject({ code: 'token_invalid' });
    expect(await claimShopifyTokenRefresh(projectId, new Date(NOW))).toBe(true);
  });

  it('keeps using a still-valid token through a transient refresh failure', async () => {
    const { fetchImpl } = refreshStub([{ status: 503 }]);
    const get = shopifyTokenProvider(projectId, await secrets(), { fetchImpl, now: () => NOW });
    expect(await get()).toBe(TOKEN);

    const expired = shopifyTokenProvider(projectId, await secrets(), {
      fetchImpl,
      now: () => NOW + 10 * 60_000
    });
    const err = await expired().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyAdminError);
    expect((err as ShopifyAdminError).code).toBe('network');
  });

  it('leaves a custom-app token alone', async () => {
    await saveShopifyTokenGrant(projectId, {
      accessToken: TOKEN,
      refreshToken: null,
      expiresAt: null,
      refreshExpiresAt: null
    });
    const s = await secrets();
    const { calls, fetchImpl } = refreshStub([{ status: 200, body: rotated(1) }]);
    const get = shopifyTokenProvider(
      projectId,
      { ...s, refreshToken: null },
      { fetchImpl, now: () => NOW }
    );
    expect(await get()).toBe(TOKEN);
    expect(calls).toHaveLength(0);
  });
});
