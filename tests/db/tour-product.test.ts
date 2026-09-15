/**
 * Which product the guided tour opens: the merchant's own when they have
 * one, the built-in sample when they do not.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PRODUCT_ID } from '@/shared/lib';
import { db } from '@/shared/db';
import { apiKeys, jobs, products } from '@/shared/db/schema';
// File path, not the view barrel: the barrel re-exports the page, which
// pulls next-auth and breaks under vitest (see MEMORY: barrel hazards).
import { pickTourProductId } from '@/views/dashboard-product/api/pick-tour-product';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;

/** A site key makes the store able to receive changes, which is what the
 *  product page requires before it shows the tour's last two anchors. */
async function connectStore() {
  await db.insert(apiKeys).values({
    id: randomUUID(),
    projectId,
    userId,
    name: 'plugin',
    prefix: 'osl_live_ab1',
    keyHash: 'a'.repeat(64),
    permissions: ['catalog:write'],
    lastUsedAt: new Date()
  });
}

/** A completed generation on a product: without one there is nothing to send,
 *  so the send-to-store control — the tenth step's anchor — never renders. */
async function addGeneration(productId: string) {
  await db.insert(jobs).values({
    id: randomUUID(),
    projectId,
    productId,
    kind: 'kie_title',
    status: 'completed'
  });
}

async function addProduct(opts: { title: string; status?: 'active' | 'archived' }) {
  const id = randomUUID();
  await db.insert(products).values({
    id,
    projectId,
    source: 'shopify',
    sourceId: `src-${id.slice(0, 8)}`,
    title: opts.title,
    status: opts.status ?? 'active',
    images: [],
    tags: [],
    variants: []
  });
  return id;
}

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
});
afterAll(resetTables);

describe('pickTourProductId', () => {
  it('falls back to the sample when the catalogue is empty', async () => {
    expect(await pickTourProductId(userId, projectId)).toBe(DEMO_PRODUCT_ID);
  });

  it('prefers the merchant’s own product once the store can receive changes', async () => {
    const mine = await addProduct({ title: 'Robe longue' });
    await connectStore();
    await addGeneration(mine);
    expect(await pickTourProductId(userId, projectId)).toBe(mine);
  });

  it('shows the sample until a product has a generation to send', async () => {
    const mine = await addProduct({ title: 'Robe longue' });
    await connectStore();
    // Connected, with a catalogue, but nothing generated yet: the send
    // control would not render, so the tenth step would point at nothing.
    expect(await pickTourProductId(userId, projectId)).toBe(DEMO_PRODUCT_ID);
    await addGeneration(mine);
    expect(await pickTourProductId(userId, projectId)).toBe(mine);
  });

  it('shows the sample while no store is connected, even with a catalogue', async () => {
    // The product page hides the send-to-store controls and the photo editor
    // until a store can receive changes — the anchors of the last two product
    // steps. Opening the real page there left them pointing at nothing.
    await addProduct({ title: 'Robe longue' });
    expect(await pickTourProductId(userId, projectId)).toBe(DEMO_PRODUCT_ID);
  });

  it('skips archived rows — they render disabled behind a banner', async () => {
    await connectStore();
    const old = await addProduct({ title: 'Vieux stock', status: 'archived' });
    await addGeneration(old);
    expect(await pickTourProductId(userId, projectId)).toBe(DEMO_PRODUCT_ID);

    const live = await addProduct({ title: 'En vente' });
    await addGeneration(live);
    expect(await pickTourProductId(userId, projectId)).toBe(live);
  });

  it('is stable across calls, so replaying the tour shows the same product', async () => {
    await connectStore();
    const a = await addProduct({ title: 'A' });
    const b = await addProduct({ title: 'B' });
    await addGeneration(a);
    await addGeneration(b);
    const first = await pickTourProductId(userId, projectId);
    expect(await pickTourProductId(userId, projectId)).toBe(first);
  });

  it('refuses a site owned by somebody else', async () => {
    const strangerProject = await createProject(await createUser());
    expect(await pickTourProductId(userId, strangerProject)).toBeNull();
    // And the row of another site is never picked.
    await db.delete(products).where(eq(products.projectId, projectId));
    expect(await pickTourProductId(userId, projectId)).toBe(DEMO_PRODUCT_ID);
  });
});
