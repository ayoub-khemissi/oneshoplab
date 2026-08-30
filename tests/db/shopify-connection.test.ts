import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getConnection,
  listDueNightlyPulls,
  listRequestedPulls,
  markTokenInvalid,
  withDecryptedToken
} from '@/entities/shop-connection';
import {
  connectShopifyStore,
  disconnectShopifyStore,
  pullShopifyCatalog
} from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { products, shopConnections } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import {
  API_SECRET,
  TOKEN,
  createFakeClient,
  fakeProduct,
  type FakeAdminClient
} from './shopify-helpers';
import { createProject } from './site-helpers';

const fakeState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/shopify-connector/api/admin-client', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('@/features/shopify-connector/api/admin-client')>();
  return {
    ...mod,
    createAdminClient: (opts: unknown) => {
      const c = fakeState.current as FakeAdminClient;
      c.lastOptions = opts as FakeAdminClient['lastOptions'];
      return c;
    }
  };
});

let userId: string;
let projectId: string;
let fake: FakeAdminClient;

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
  fake = createFakeClient([fakeProduct('1'), fakeProduct('2', { title: 'Second' })]);
  fakeState.current = fake;
});
afterAll(async () => {
  await db.$client.end();
});

async function rawRow() {
  const [row] = await db
    .select()
    .from(shopConnections)
    .where(eq(shopConnections.projectId, projectId));
  return row;
}

describe('connect / validate', () => {
  it('validates with shop.json-equivalent, seals the token, registers webhooks, queues a pull', async () => {
    const res = await connectShopifyStore({
      projectId,
      userId,
      shopDomain: 'https://Atelier.myshopify.com/admin',
      accessToken: TOKEN,
      apiSecret: API_SECRET
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.shopName).toBe('Atelier');
    expect(res.webhooks).toBe('registered');
    expect(res.connection.hasWebhookSecret).toBe(true);
    expect(fake.lastOptions).toMatchObject({
      shopDomain: 'atelier.myshopify.com',
      accessToken: TOKEN
    });
    expect(fake.calls.webhookCreate.map((c) => c.topic)).toEqual([
      'PRODUCTS_UPDATE',
      'PRODUCTS_DELETE'
    ]);
    expect(fake.calls.webhookCreate[0].url).toBe(
      `http://localhost:3030/api/webhooks/shopify/${projectId}`
    );

    const row = await rawRow();
    expect(row.status).toBe('connected');
    expect(row.shopName).toBe('Atelier');
    expect(row.scopes).toEqual(['read_products', 'write_products']);
    expect(row.apiVersion).toBe('2025-07');
    expect(row.accessTokenCiphertext.startsWith('v1:')).toBe(true);
    expect(row.webhookIds).toHaveLength(2);
    expect(row.pullRequestedAt).not.toBeNull();
    // Never the plaintext, in no column.
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(JSON.stringify(row)).not.toContain(API_SECRET);

    const pub = await getConnection(projectId);
    expect(pub && 'accessTokenCiphertext' in pub).toBe(false);
    expect(pub && 'webhookSecretCiphertext' in pub).toBe(false);
    const seen = await withDecryptedToken(projectId, async (s) => s);
    expect(seen).toMatchObject({ accessToken: TOKEN, webhookSecret: API_SECRET });
  });

  it('without the API secret: connected, no webhooks, pulls only', async () => {
    const res = await connectShopifyStore({
      projectId,
      userId,
      shopDomain: 'atelier.myshopify.com',
      accessToken: TOKEN
    });
    expect(res.ok && res.webhooks).toBe('skipped');
    expect(fake.calls.webhookCreate).toEqual([]);
    const row = await rawRow();
    expect(row.webhookSecretCiphertext).toBeNull();
    expect(row.webhookIds).toBeNull();
  });

  it('refuses bad domains, wrong tokens, foreign projects and a mismatching shop', async () => {
    const base = { projectId, userId, accessToken: TOKEN };
    expect(await connectShopifyStore({ ...base, shopDomain: 'example.com' })).toEqual({
      ok: false,
      reason: 'invalid_domain'
    });
    fake.tokenInvalid = true;
    expect(
      await connectShopifyStore({ ...base, shopDomain: 'atelier.myshopify.com' })
    ).toMatchObject({
      ok: false,
      reason: 'token_invalid'
    });
    fake.tokenInvalid = false;
    expect(await connectShopifyStore({ ...base, shopDomain: 'other.myshopify.com' })).toMatchObject(
      {
        ok: false,
        reason: 'domain_mismatch'
      }
    );
    const stranger = await createUser();
    expect(
      await connectShopifyStore({ ...base, userId: stranger, shopDomain: 'atelier.myshopify.com' })
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await getConnection(projectId)).toBeNull();
  });

  it('disconnect deletes the webhooks, wipes the ciphertext and revokes', async () => {
    await connectShopifyStore({
      projectId,
      userId,
      shopDomain: 'atelier.myshopify.com',
      accessToken: TOKEN,
      apiSecret: API_SECRET
    });
    const stranger = await createUser();
    expect(await disconnectShopifyStore(projectId, stranger)).toBe(false);
    expect(await disconnectShopifyStore(projectId, userId)).toBe(true);
    expect(fake.calls.webhookDelete).toHaveLength(2);
    const row = await rawRow();
    expect(row.status).toBe('revoked');
    expect(row.accessTokenCiphertext).toBe('');
    expect(row.webhookSecretCiphertext).toBeNull();
    expect(row.webhookIds).toBeNull();
    expect(row.revokedAt).not.toBeNull();
    expect(await withDecryptedToken(projectId, async () => 'x')).toBeNull();
    // Reconnecting restores a live row (same projectId, unique).
    const again = await connectShopifyStore({
      projectId,
      userId,
      shopDomain: 'atelier.myshopify.com',
      accessToken: TOKEN
    });
    expect(again.ok).toBe(true);
    expect((await rawRow()).status).toBe('connected');
  });
});

describe('full pull', () => {
  beforeEach(async () => {
    await connectShopifyStore({
      projectId,
      userId,
      shopDomain: 'atelier.myshopify.com',
      accessToken: TOKEN
    });
  });

  it('upserts every page, archives what Shopify no longer lists, stamps lastPullAt', async () => {
    await createProduct(projectId, { sourceId: '999', title: 'Gone' });
    expect((await listRequestedPulls()).map((c) => c.projectId)).toEqual([projectId]);
    const res = await pullShopifyCatalog(projectId);
    expect(res).toMatchObject({ ok: true, fetched: 2, inserted: 2, archived: 1, truncated: false });
    const rows = await db.select().from(products).where(eq(products.projectId, projectId));
    const byId = new Map(rows.map((r) => [r.sourceId, r]));
    expect(byId.get('2')?.title).toBe('Second');
    expect(byId.get('2')?.currency).toBe('EUR');
    expect(byId.get('999')?.status).toBe('archived');
    const row = await rawRow();
    expect(row.lastPullAt).not.toBeNull();
    expect(row.pullRequestedAt).toBeNull();
    expect(row.pullProgress).toMatchObject({ phase: 'done', fetched: 2 });
    expect(await listRequestedPulls()).toEqual([]);
    expect(await listDueNightlyPulls()).toEqual([]);
    expect(
      (await listDueNightlyPulls(new Date(Date.now() + 25 * 3600_000))).map((c) => c.projectId)
    ).toEqual([projectId]);
  });

  it('stops at the plan limit and says so', async () => {
    fake = createFakeClient(Array.from({ length: 205 }, (_, i) => fakeProduct(String(i + 1))));
    fakeState.current = fake;
    const res = await pullShopifyCatalog(projectId);
    expect(res).toMatchObject({ ok: true, fetched: 200, truncated: true });
    expect((await rawRow()).pullProgress?.error).toBe('plan_limit:200');
  });

  it('a 401 flips the connection to token_invalid and the row keeps no progress', async () => {
    fake.tokenInvalid = true;
    expect(await pullShopifyCatalog(projectId)).toMatchObject({
      ok: false,
      reason: 'token_invalid'
    });
    const row = await rawRow();
    expect(row.status).toBe('token_invalid');
    expect(row.lastError).toContain('401');
    expect(await listDueNightlyPulls()).toEqual([]);
    expect(await pullShopifyCatalog(projectId)).toMatchObject({
      ok: false,
      reason: 'token_invalid'
    });
  });

  it('markTokenInvalid only touches connected rows', async () => {
    await disconnectShopifyStore(projectId, userId);
    await markTokenInvalid(projectId, 'late 401');
    expect((await rawRow()).status).toBe('revoked');
  });
});
