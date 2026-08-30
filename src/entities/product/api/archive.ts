import { and, count, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';

export type ArchiveProductResult = 'archived' | 'already_archived' | 'not_found';

/** Soft-archive by sourceId (generation history must survive — never a DELETE). */
export async function archiveProductBySourceId(
  projectId: string,
  sourceId: string
): Promise<ArchiveProductResult> {
  const [row] = await db
    .select({ id: products.id, status: products.status })
    .from(products)
    .where(and(eq(products.projectId, projectId), eq(products.sourceId, sourceId)));
  if (!row) return 'not_found';
  if (row.status === 'archived') return 'already_archived';
  await db
    .update(products)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(eq(products.id, row.id));
  return 'archived';
}

/** Final page of a full sync: archive active rows whose sourceId was not seen. */
export async function archiveProductsNotSeen(
  projectId: string,
  seenSourceIds: readonly string[]
): Promise<number> {
  const where = [eq(products.projectId, projectId), eq(products.status, 'active')];
  if (seenSourceIds.length > 0) where.push(notInArray(products.sourceId, [...seenSourceIds]));
  const [res] = await db
    .update(products)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(and(...where));
  return res.affectedRows;
}

export async function countActiveProducts(projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(products)
    .where(and(eq(products.projectId, projectId), eq(products.status, 'active')));
  return Number(row?.n ?? 0);
}

/** Which of `sourceIds` already exist in the project (any status). */
export async function existingSourceIds(
  projectId: string,
  sourceIds: readonly string[]
): Promise<Set<string>> {
  if (sourceIds.length === 0) return new Set();
  const rows = await db
    .select({ sourceId: products.sourceId })
    .from(products)
    .where(and(eq(products.projectId, projectId), inArray(products.sourceId, [...sourceIds])));
  return new Set(rows.flatMap((r) => (r.sourceId ? [r.sourceId] : [])));
}
