import { and, count, eq, max } from 'drizzle-orm';
import { db } from '@/shared/db';
import { products, type Platform } from '@/shared/db/schema';
import type { NormalizedProduct } from '@/entities/store-adapter';
import { productRowToNormalized } from '../lib/to-normalized';

export interface CatalogState {
  /** Active products currently stored for the project. */
  size: number;
  /**
   * Last time a sync touched the catalog. `lastSeenAt` is re-stamped by
   * `syncProjectProducts` on every matched row, whatever the writer
   * (connector pull, plugin page, webhook), so it is the one marker that
   * works for all of them. Null = nothing was ever synced.
   */
  syncedAt: Date | null;
  /** Platform the rows were synced from; null on an empty catalog. */
  platform: Platform | null;
}

/** MySQL may hand an aggregate back as a string depending on the driver path. */
function toDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Cheap aggregate — no row bodies, safe to call on a 5k-product catalog. */
export async function getCatalogState(projectId: string): Promise<CatalogState> {
  const where = and(eq(products.projectId, projectId), eq(products.status, 'active'));
  const [agg] = await db
    .select({ size: count(), syncedAt: max(products.lastSeenAt) })
    .from(products)
    .where(where);
  const size = Number(agg?.size ?? 0);
  if (size === 0) return { size: 0, syncedAt: null, platform: null };
  const [first] = await db.select({ source: products.source }).from(products).where(where).limit(1);
  return { size, syncedAt: toDate(agg?.syncedAt ?? null), platform: first?.source ?? null };
}

/** Active catalog of a project in the shape the scorer consumes. */
export async function loadProjectCatalog(projectId: string): Promise<NormalizedProduct[]> {
  const rows = await db.query.products.findMany({
    where: and(eq(products.projectId, projectId), eq(products.status, 'active'))
  });
  return rows.map((row) => productRowToNormalized(row));
}
