import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProjectCapabilities,
  PLATFORM_CAPABILITIES,
  saveReportedCapabilities
} from '@/entities/connection-capability';
import { createChange, hashValue } from '@/entities/product-change';
import { getConnection, listForApply } from '@/entities/shop-connection';
import {
  applyShopifyChanges,
  connectShopifyStore,
  mapAdminProduct,
  runShopifyApplies
} from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { productChanges, products, type ProductChangeField } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { TOKEN, createFakeClient, fakeProduct, type FakeAdminClient } from './shopify-helpers';
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
let product: { id: string; sourceId: string };

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
  // Shopify and OSL agree on the title/tags at approval time.
  fake = createFakeClient([fakeProduct('77', { title: 'Old title', tags: ['a', 'b'] })]);
  fakeState.current = fake;
  product = await createProduct(projectId, {
    sourceId: '77',
    title: 'Old title',
    tags: ['a', 'b']
  });
  const mapped = mapAdminProduct(fake.products.get('77')!, { shopDomain: 'x', currency: null });
  await db
    .update(products)
    .set({ descriptionHtml: mapped.descriptionHtml, images: mapped.images })
    .where(eq(products.id, product.id));
  await connectShopifyStore({
    projectId,
    userId,
    shopDomain: 'atelier.myshopify.com',
    accessToken: TOKEN
  });
});
afterAll(async () => {
  await db.$client.end();
});

async function change(field: ProductChangeField, value: unknown, expiresAt?: Date) {
  const res = await createChange({
    projectId,
    productId: product.id,
    productSourceId: product.sourceId,
    field,
    value,
    approvedBy: userId,
    expiresAt
  });
  if (!res.ok) throw new Error('create');
  return res.change.id;
}
async function status(id: string) {
  const [r] = await db.select().from(productChanges).where(eq(productChanges.id, id));
  return r;
}

describe('apply step', () => {
  it('applied: writes title/tags through productUpdate and acks with the store hash', async () => {
    const t = await change('title', 'New title');
    const g = await change('tags', ['x', 'y']);
    const res = await applyShopifyChanges(projectId);
    expect(res.outcomes.map((o) => o.outcome)).toEqual(['applied', 'applied']);
    expect(fake.calls.productUpdate).toEqual([
      { id: '77', title: 'New title' },
      { id: '77', tags: ['x', 'y'] }
    ]);
    const row = await status(t);
    expect(row.status).toBe('applied');
    expect(row.ackPayload).toMatchObject({
      status: 'applied',
      storeValueHash: hashValue('Old title')
    });
    expect(row.ackedAt).not.toBeNull();
    expect((await status(g)).status).toBe('applied');
    // Nothing left: the tick query no longer lists the project.
    expect(await listForApply()).toEqual([]);
  });

  it('conflict: the field changed in Shopify since approval → nothing written', async () => {
    const id = await change('title', 'New title');
    fake.products.get('77')!.title = 'Edited in Shopify';
    const res = await applyShopifyChanges(projectId);
    expect(res.outcomes).toEqual([{ changeId: id, outcome: 'conflict' }]);
    expect(fake.calls.productUpdate).toEqual([]);
    expect((await status(id)).status).toBe('conflict');
  });

  it('images: R2 URLs go through productCreateMedia; an expired change is skipped as expired', async () => {
    const live = await change('images', [
      { src: 'https://cdn.oneshoplab.com/gen/a.jpg', alt: 'A' }
    ]);
    const stale = await change(
      'images',
      [{ src: 'https://cdn.oneshoplab.com/gen/b.jpg', alt: null }],
      new Date(Date.now() - 1000)
    );
    const res = await applyShopifyChanges(projectId);
    expect(res.outcomes.map((o) => o.outcome)).toEqual(['applied', 'expired']);
    expect(fake.calls.productCreateMedia).toEqual([
      { id: '77', media: [{ originalSource: 'https://cdn.oneshoplab.com/gen/a.jpg', alt: 'A' }] }
    ]);
    expect((await status(live)).status).toBe('applied');
    expect((await status(stale)).status).toBe('expired');
  });

  it('a live connection is what getProjectCapabilities answers with', async () => {
    // A plugin report on the same project must not win over the connector that
    // will actually execute the ops.
    await saveReportedCapabilities(projectId, 'woocommerce', { stableImageIds: false });
    expect(await getProjectCapabilities(projectId)).toEqual(PLATFORM_CAPABILITIES.shopify);
  });

  it('images ops: media created, detached and reordered; unsupported ops come back in skippedOps', async () => {
    // The fixture product carries two MediaImages: 31000000000001 / …002.
    const id = await change('images', {
      v: 1,
      ops: [
        { op: 'append', image: { src: 'https://cdn.oneshoplab.com/gen/a.jpg', alt: 'A' } },
        { op: 'reorder', order: ['new:0', 'gid://shopify/MediaImage/31000000000001'] },
        { op: 'remove', target: 'gid://shopify/MediaImage/31000000000002' },
        { op: 'remove', target: 'gid://shopify/MediaImage/does-not-exist' },
        { op: 'set_alt', target: 'gid://shopify/MediaImage/31000000000001', alt: 'Grès' }
      ]
    });
    const res = await applyShopifyChanges(projectId);
    expect(res.outcomes.map((o) => o.outcome)).toEqual(['applied']);
    expect(fake.calls.productCreateMedia).toEqual([
      { id: '77', media: [{ originalSource: 'https://cdn.oneshoplab.com/gen/a.jpg', alt: 'A' }] }
    ]);
    expect(fake.calls.productDeleteMedia).toEqual([
      { id: '77', mediaIds: ['gid://shopify/MediaImage/31000000000002'] }
    ]);
    expect(fake.calls.productReorderMedia).toHaveLength(1);
    const row = await status(id);
    expect(row.status).toBe('applied');
    // 3 = a target the store no longer has, 4 = set_alt, which Shopify's
    // scopes do not allow us to run. Reported, never fatal.
    expect(row.ackPayload).toMatchObject({ skippedOps: ['3:remove', '4:set_alt'] });
  });

  it('images ops: the last image in the store is never removed', async () => {
    // The change is legal against OSL's view (two images, one removed), but the
    // merchant already deleted the other one in Shopify: the executor refuses
    // rather than leaving the product with a placeholder.
    const id = await change('images', {
      v: 1,
      ops: [{ op: 'remove', target: 'gid://shopify/MediaImage/31000000000001' }]
    });
    fake.products.get('77')!.media.nodes = [
      {
        id: 'gid://shopify/MediaImage/31000000000001',
        alt: null,
        image: {
          url: 'https://cdn.shopify.com/s/files/1/0001/front.jpg',
          width: 1200,
          height: 1600
        }
      }
    ];
    // OSL's hash is computed from that same single image so the loop does not
    // stop at the conflict check — the guard under test is the executor's.
    await db
      .update(products)
      .set({
        images: [
          {
            src: 'https://cdn.shopify.com/s/files/1/0001/front.jpg',
            alt: null,
            width: 1200,
            height: 1600,
            sourceImageId: 'gid://shopify/MediaImage/31000000000001'
          }
        ]
      })
      .where(eq(products.id, product.id));
    await db
      .update(productChanges)
      .set({
        priorValueHash: hashValue([
          { src: 'https://cdn.shopify.com/s/files/1/0001/front.jpg', alt: null }
        ])
      })
      .where(eq(productChanges.id, id));

    const res = await applyShopifyChanges(projectId);
    expect(res.outcomes.map((o) => o.outcome)).toEqual(['applied']);
    expect(fake.calls.productDeleteMedia).toEqual([]);
    expect((await status(id)).ackPayload).toMatchObject({ skippedOps: ['0:remove'] });
  });

  it('failed: a Shopify userError acks failed with the message; a missing product too', async () => {
    const id = await change('description', '<p>x</p>');
    fake.productUpdate = async () => {
      throw new Error('productUpdate: descriptionHtml: too long');
    };
    const gone = await createProduct(projectId, { sourceId: '404', title: 'Gone' });
    const res2 = await createChange({
      projectId,
      productId: gone.id,
      productSourceId: '404',
      field: 'title',
      value: 'x',
      approvedBy: userId
    });
    const res = await applyShopifyChanges(projectId);
    expect(res.outcomes.map((o) => o.outcome)).toEqual(['failed', 'failed']);
    expect((await status(id)).ackPayload).toMatchObject({
      status: 'failed',
      error: 'productUpdate: descriptionHtml: too long'
    });
    expect(res2.ok && (await status(res2.change.id)).ackPayload?.error).toBe('product_not_found');
  });

  it('token_invalid: marks the connection, leaves the change pending, stops the batch', async () => {
    const a = await change('title', 'A');
    const b = await change('title', 'B');
    fake.tokenInvalid = true;
    const res = await runShopifyApplies();
    expect(res).toHaveLength(1);
    expect(res[0].outcomes).toEqual([
      { changeId: a, outcome: 'token_invalid', error: expect.stringContaining('401') }
    ]);
    expect((await status(a)).status).toBe('pending');
    expect((await status(b)).status).toBe('pending');
    expect((await getConnection(projectId))?.status).toBe('token_invalid');
    // No retries until a new token is saved.
    expect(await listForApply()).toEqual([]);
    expect(await runShopifyApplies()).toEqual([]);
  });

  it('runShopifyApplies only visits connected projects with pending changes', async () => {
    const other = await createProject(userId, 'No connection');
    const p2 = await createProduct(other, { sourceId: '1' });
    await createChange({
      projectId: other,
      productId: p2.id,
      productSourceId: '1',
      field: 'title',
      value: 'x',
      approvedBy: userId
    });
    expect(await runShopifyApplies()).toEqual([]);
    await change('title', 'Z');
    expect((await runShopifyApplies()).map((r) => r.projectId)).toEqual([projectId]);
  });
});
