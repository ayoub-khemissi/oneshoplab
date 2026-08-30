import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/webhooks/shopify/[projectId]/route';
import { getConnection } from '@/entities/shop-connection';
import { connectShopifyStore } from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import {
  API_SECRET,
  TOKEN,
  createFakeClient,
  fakeProduct,
  shopifyHeaders,
  type FakeAdminClient
} from './shopify-helpers';
import { createProject } from './site-helpers';

const fakeState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/shopify-connector/api/admin-client', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('@/features/shopify-connector/api/admin-client')>();
  return { ...mod, createAdminClient: () => fakeState.current as FakeAdminClient };
});

let userId: string;
let projectId: string;
let fake: FakeAdminClient;

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
  fake = createFakeClient([fakeProduct('77', { title: 'Fresh from Shopify' })]);
  fakeState.current = fake;
  await connectShopifyStore({
    projectId,
    userId,
    shopDomain: 'atelier.myshopify.com',
    accessToken: TOKEN,
    apiSecret: API_SECRET
  });
});
afterAll(async () => {
  await db.$client.end();
});

async function post(body: string, headers: Record<string, string>, pid = projectId) {
  const req = new Request(`http://localhost:3030/api/webhooks/shopify/${pid}`, {
    method: 'POST',
    headers,
    body
  });
  const res = await POST(req, { params: Promise.resolve({ projectId: pid }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
async function productRow(sourceId: string) {
  const [r] = await db
    .select()
    .from(products)
    .where(eq(products.projectId, projectId) && eq(products.sourceId, sourceId));
  return r;
}

const updateBody = JSON.stringify({ id: 77, title: 'ignored — re-read via Admin API' });

describe('POST /api/webhooks/shopify/[projectId]', () => {
  it('401 on a bad HMAC / wrong secret, 404 on an unknown project', async () => {
    const bad = {
      ...shopifyHeaders(updateBody, 'products/update'),
      'x-shopify-hmac-sha256': 'AAAA'
    };
    expect((await post(updateBody, bad)).status).toBe(401);
    expect(
      (await post(updateBody, shopifyHeaders(updateBody, 'products/update', { secret: 'other' })))
        .status
    ).toBe(401);
    expect(
      (await post(updateBody, shopifyHeaders(updateBody, 'products/update'), 'nope')).status
    ).toBe(404);
    expect(await productRow('77')).toBeUndefined();
  });

  it('products/update → the product is re-read and upserted; a replay is ignored', async () => {
    const headers = shopifyHeaders(updateBody, 'products/update', { webhookId: 'wh-1' });
    const first = await post(updateBody, headers);
    expect(first).toEqual({ status: 200, json: { ok: true, action: 'upserted' } });
    expect((await productRow('77')).title).toBe('Fresh from Shopify');
    expect((await getConnection(projectId))?.lastWebhookAt).not.toBeNull();

    fake.products.get('77')!.title = 'Changed again';
    const replay = await post(updateBody, headers);
    expect(replay).toEqual({ status: 200, json: { ok: true, replay: true } });
    expect((await productRow('77')).title).toBe('Fresh from Shopify');
    expect(fake.calls.productById).toEqual(['77']);
  });

  it('products/delete → archived (idempotent); an update for a vanished product archives too', async () => {
    await createProduct(projectId, { sourceId: '77', title: 'Old' });
    const del = JSON.stringify({ id: 77 });
    expect((await post(del, shopifyHeaders(del, 'products/delete'))).json).toEqual({
      ok: true,
      action: 'archived'
    });
    expect((await productRow('77')).status).toBe('archived');
    expect((await post(del, shopifyHeaders(del, 'products/delete'))).json).toEqual({
      ok: true,
      action: 'already_archived'
    });
    fake.products.delete('77');
    await createProduct(projectId, { sourceId: '78', title: 'Old' });
    const upd = JSON.stringify({ id: 78 });
    expect((await post(upd, shopifyHeaders(upd, 'products/update'))).json).toEqual({
      ok: true,
      action: 'archived'
    });
  });

  it('a connection without the API secret cannot be verified → 401; a 401 upstream flips the status', async () => {
    fake.tokenInvalid = true;
    const r = await post(updateBody, shopifyHeaders(updateBody, 'products/update'));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, action: 'failed' });
    expect((await getConnection(projectId))?.status).toBe('token_invalid');

    fake.tokenInvalid = false;
    const other = await createProject(userId, 'No secret');
    await connectShopifyStore({
      projectId: other,
      userId,
      shopDomain: 'atelier.myshopify.com',
      accessToken: TOKEN
    });
    expect(
      (await post(updateBody, shopifyHeaders(updateBody, 'products/update'), other)).status
    ).toBe(401);
  });
});
