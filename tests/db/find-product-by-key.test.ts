/**
 * A job must attach to its product whichever key it was filed under: the
 * platform id (the rule), the handle (the storefront-audit era and a fixed
 * bug), or the row id.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { findProductIdByKey } from '@/entities/product/api/find-by-key';
import { eq } from 'drizzle-orm';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

let projectId: string;
let rowId: string;

beforeEach(async () => {
  await resetTables();
  const userId = await createUser();
  projectId = await createProject(userId);
  rowId = (await createProduct(projectId, { sourceId: 'df8ae122' })).id;
  await db.update(products).set({ handle: 'crew-t-shirt' }).where(eq(products.id, rowId));
});
afterAll(async () => {
  await db.$client.end();
});

describe('findProductIdByKey', () => {
  it('finds the row by platform id, by handle and by row id', async () => {
    expect(await findProductIdByKey(projectId, 'df8ae122')).toBe(rowId);
    expect(await findProductIdByKey(projectId, 'crew-t-shirt')).toBe(rowId);
    expect(await findProductIdByKey(projectId, rowId)).toBe(rowId);
  });
  it('stays inside the project and answers null for an unknown key', async () => {
    expect(await findProductIdByKey('another-project', 'df8ae122')).toBeNull();
    expect(await findProductIdByKey(projectId, 'nope')).toBeNull();
    expect(await findProductIdByKey(projectId, '')).toBeNull();
  });
});
