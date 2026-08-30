/**
 * Public-app path: install → Shopify authorize → callback (token exchange
 * stubbed on global fetch), GDPR compliance webhooks, app/uninstalled.
 */
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null)
}));
const fakeState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/shopify-connector/api/admin-client', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('@/features/shopify-connector/api/admin-client')>();
  return { ...mod, createAdminClient: () => fakeState.current as FakeAdminClient };
});

import { GET as installGet } from '@/app/api/integrations/shopify/install/route';
import { GET as callbackGet } from '@/app/api/integrations/shopify/callback/route';
import { POST as gdprPost } from '@/app/api/webhooks/shopify/gdpr/[topic]/route';
import { POST as webhookPost } from '@/app/api/webhooks/shopify/[projectId]/route';
import { getConnection, listGdprRequests } from '@/entities/shop-connection';
import { SHOPIFY_STATE_COOKIE } from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { shopConnections } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { TOKEN, createFakeClient, shopifyHeaders, type FakeAdminClient } from './shopify-helpers';
import { createProject } from './site-helpers';
import { NextRequest } from 'next/server';

const CLIENT_SECRET = 'shpss_' + 'y'.repeat(32);
const SHOP = 'atelier.myshopify.com';
let userId: string;
let projectId: string;
let fake: FakeAdminClient;

beforeEach(async () => {
  await resetTables();
  process.env.SHOPIFY_APP_CLIENT_ID = 'client-id';
  process.env.SHOPIFY_APP_CLIENT_SECRET = CLIENT_SECRET;
  delete process.env.SHOPIFY_APP_SCOPES;
  userId = await createUser();
  session.userId = userId;
  projectId = await createProject(userId);
  fake = createFakeClient();
  fakeState.current = fake;
  vi.unstubAllGlobals();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$client.end();
});

function stubExchange(body: Record<string, unknown> | null, status = 200) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(body ? JSON.stringify(body) : 'nope', { status });
  });
  return calls;
}

async function install(query: Record<string, string>) {
  const req = new NextRequest(
    `http://localhost:3030/api/integrations/shopify/install?${new URLSearchParams(query)}`
  );
  const res = await installGet(req);
  const cookie = res.cookies.get(SHOPIFY_STATE_COOKIE)?.value ?? null;
  return { res, cookie, location: res.headers.get('location') };
}

function signedQuery(params: Record<string, string>, secret = CLIENT_SECRET) {
  const msg = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return new URLSearchParams({
    ...params,
    hmac: createHmac('sha256', secret).update(msg).digest('hex')
  });
}

async function callback(params: Record<string, string>, cookie: string | null, secret?: string) {
  const req = new NextRequest(
    `http://localhost:3030/api/integrations/shopify/callback?${signedQuery(params, secret)}`,
    {
      headers: cookie ? { cookie: `${SHOPIFY_STATE_COOKIE}=${cookie}` } : {}
    }
  );
  const res = await callbackGet(req);
  return new URL(res.headers.get('location') ?? 'http://x/');
}

describe('GET /api/integrations/shopify/install', () => {
  it('redirects the owner to Shopify with a signed state cookie', async () => {
    const { res, cookie, location } = await install({ projectId, shop: SHOP, locale: 'fr' });
    expect(res.status).toBe(307);
    const url = new URL(location!);
    expect(url.origin + url.pathname).toBe(`https://${SHOP}/admin/oauth/authorize`);
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3030/api/integrations/shopify/callback'
    );
    expect(cookie).toBeTruthy();
  });
  it('401 without session, 404 for a foreign project, bounces on a bad domain / unconfigured app', async () => {
    session.userId = null;
    expect((await install({ projectId, shop: SHOP })).res.status).toBe(401);
    session.userId = await createUser();
    expect((await install({ projectId, shop: SHOP })).res.status).toBe(404);
    session.userId = userId;
    expect((await install({ projectId, shop: 'not a shop' })).location).toContain(
      'error=invalid_domain'
    );
    delete process.env.SHOPIFY_APP_CLIENT_ID;
    expect((await install({ projectId, shop: SHOP })).location).toContain('error=not_configured');
  });
});

describe('GET /api/integrations/shopify/callback', () => {
  it('exchanges the code, stores an oauth connection, registers 3 webhooks, queues a pull', async () => {
    const { cookie, location } = await install({ projectId, shop: SHOP, locale: 'fr' });
    const state = new URL(location!).searchParams.get('state')!;
    const calls = stubExchange({ access_token: TOKEN, scope: 'write_products,read_products' });
    const to = await callback({ code: 'c0de', shop: SHOP, state, timestamp: '1' }, cookie);
    expect(to.pathname).toBe(`/fr/dashboard/sites/${projectId}`);
    expect(to.searchParams.get('connected')).toBe('shopify');
    expect(calls[0]).toMatchObject({
      url: `https://${SHOP}/admin/oauth/access_token`,
      body: { client_id: 'client-id', client_secret: CLIENT_SECRET, code: 'c0de' }
    });
    const c = await getConnection(projectId);
    expect(c).toMatchObject({
      status: 'connected',
      authMode: 'oauth',
      shopDomain: SHOP,
      shopName: 'Atelier',
      hasWebhookSecret: true
    });
    expect(c!.installedViaOauthAt).not.toBeNull();
    expect(c!.pullRequestedAt).not.toBeNull();
    expect(fake.calls.webhookCreate.map((w) => w.topic)).toEqual([
      'PRODUCTS_UPDATE',
      'PRODUCTS_DELETE',
      'APP_UNINSTALLED'
    ]);
    const [raw] = await db
      .select()
      .from(shopConnections)
      .where(eq(shopConnections.projectId, projectId));
    expect(raw.accessTokenCiphertext).toMatch(/^v1:/);
    expect(raw.accessTokenCiphertext).not.toContain(TOKEN);
  });
  it('bad HMAC / bad state / missing scopes / failed exchange → error redirect, nothing stored', async () => {
    const { cookie, location } = await install({ projectId, shop: SHOP });
    const state = new URL(location!).searchParams.get('state')!;
    stubExchange({ access_token: TOKEN, scope: 'read_products' });
    const q = { code: 'c', shop: SHOP, state, timestamp: '1' };
    expect((await callback(q, cookie, 'wrong')).searchParams.get('error')).toBe('bad_hmac');
    expect((await callback({ ...q, state: 'forged' }, cookie)).searchParams.get('error')).toBe(
      'bad_state'
    );
    expect((await callback(q, null)).searchParams.get('error')).toBe('bad_state');
    expect((await callback(q, cookie)).searchParams.get('error')).toBe('scopes_missing');
    stubExchange(null, 400);
    expect((await callback(q, cookie)).searchParams.get('error')).toBe('exchange_failed');
    session.userId = null;
    expect((await callback(q, cookie)).searchParams.get('error')).toBe('unauthorized');
    expect(await getConnection(projectId)).toBeNull();
  });
});

async function gdpr(topic: string, body: Record<string, unknown>, secret = CLIENT_SECRET) {
  const raw = JSON.stringify(body);
  const req = new Request(`http://localhost:3030/api/webhooks/shopify/gdpr/${topic}`, {
    method: 'POST',
    headers: shopifyHeaders(raw, topic, { secret }),
    body: raw
  });
  const res = await gdprPost(req, { params: Promise.resolve({ topic }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function connectViaOauth() {
  const { cookie, location } = await install({ projectId, shop: SHOP });
  const state = new URL(location!).searchParams.get('state')!;
  stubExchange({ access_token: TOKEN, scope: 'write_products' });
  await callback({ code: 'c', shop: SHOP, state, timestamp: '1' }, cookie);
}

describe('GDPR webhooks + app/uninstalled', () => {
  it('401 without a valid HMAC, 404 on an unknown topic', async () => {
    expect((await gdpr('customers-redact', { shop_domain: SHOP }, 'other')).status).toBe(401);
    expect((await gdpr('nope', { shop_domain: SHOP })).status).toBe(404);
  });
  it('logs customers/* requests; shop/redact wipes the shop’s connections', async () => {
    await connectViaOauth();
    expect(
      (await gdpr('customers-data-request', { shop_domain: SHOP, customer: { id: 1 } })).json
    ).toMatchObject({ ok: true, action: 'logged' });
    expect((await gdpr('shop-redact', { shop_domain: SHOP })).json).toMatchObject({
      ok: true,
      action: 'revoked:1'
    });
    const c = await getConnection(projectId);
    expect(c!.status).toBe('revoked');
    const [raw] = await db
      .select()
      .from(shopConnections)
      .where(eq(shopConnections.projectId, projectId));
    expect(raw.accessTokenCiphertext).toBe('');
    expect((await listGdprRequests(SHOP)).map((r) => r.topic).sort()).toEqual([
      'customers/data_request',
      'shop/redact'
    ]);
  });
  it('app/uninstalled revokes the connection', async () => {
    await connectViaOauth();
    const raw = JSON.stringify({ id: 1, domain: SHOP });
    const req = new Request(`http://localhost:3030/api/webhooks/shopify/${projectId}`, {
      method: 'POST',
      headers: shopifyHeaders(raw, 'app/uninstalled', { secret: CLIENT_SECRET }),
      body: raw
    });
    const res = await webhookPost(req, { params: Promise.resolve({ projectId }) });
    expect(await res.json()).toMatchObject({ ok: true, action: 'revoked' });
    expect((await getConnection(projectId))!.status).toBe('revoked');
  });
});
