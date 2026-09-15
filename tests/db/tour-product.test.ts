/**
 * Which product the guided tour opens: the merchant's own when they have
 * one, the built-in sample when they do not.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PRODUCT_ID } from '@/shared/lib';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
// File path, not the view barrel: the barrel re-exports the page, which
// pulls next-auth and breaks under vitest (see MEMORY: barrel hazards).
import { pickTourProductId } from '@/views/dashboard-product/api/pick-tour-product';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;

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

  it('prefers the merchant’s own product', async () => {
    const mine = await addProduct({ title: 'Robe longue' });
    expect(await pickTourProductId(userId, projectId)).toBe(mine);
  });

  it('skips archived rows — they render disabled behind a banner', async () => {
    await addProduct({ title: 'Vieux stock', status: 'archived' });
    expect(await pickTourProductId(userId, projectId)).toBe(DEMO_PRODUCT_ID);

    const live = await addProduct({ title: 'En vente' });
    expect(await pickTourProductId(userId, projectId)).toBe(live);
  });

  it('is stable across calls, so replaying the tour shows the same product', async () => {
    await addProduct({ title: 'A' });
    await addProduct({ title: 'B' });
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
