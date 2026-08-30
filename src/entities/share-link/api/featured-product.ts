import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/shared/db';
import { jobs, products } from '@/shared/db/schema';
import type { FeaturedProductSnapshot } from '../model/types';

export async function resolveFeaturedProduct(
  projectId: string,
  sourceId: string,
  allProducts: Array<{
    sourceId?: string | null;
    handle?: string | null;
    title: string;
    url?: string | null;
    descriptionHtml?: string;
    images?: Array<{ src: string; alt?: string | null }>;
    signals?: { tags?: string[] };
  }>
): Promise<FeaturedProductSnapshot | null> {
  const fromSummary = allProducts.find((p) => (p.sourceId ?? p.handle ?? '') === sourceId);
  if (fromSummary) return fromSummary;

  // Summary lost it (catalog id rotation / duplicate-handle churn).
  // Three fallbacks, increasingly resilient:
  //   1. products row by current sourceId
  //   2. products row by handle (if the stored id IS a handle)
  //   3. via the jobs table — the AI jobs immutably record the
  //      productSourceId used at generation time and are FK'd
  //      (jobs.product_id, backfilled) to the canonical products
  //      row. This is the ONLY link that survives unbounded
  //      upstream id rotation (WooCommerce re-issuing the catalog
  //      id on every scrape), which is exactly the moycor case.
  let row =
    (await db.query.products.findFirst({
      where: and(eq(products.projectId, projectId), eq(products.sourceId, sourceId))
    })) ??
    (await db.query.products.findFirst({
      where: and(eq(products.projectId, projectId), eq(products.handle, sourceId))
    })) ??
    null;
  if (!row) {
    const job = await db.query.jobs.findFirst({
      where: and(
        eq(jobs.projectId, projectId),
        isNotNull(jobs.productId),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${jobs.inputPayload}, '$.productSourceId')) = ${sourceId}`
      )
    });
    if (job?.productId) {
      row =
        (await db.query.products.findFirst({
          where: eq(products.id, job.productId)
        })) ?? null;
    }
  }
  if (!row) return null;
  return {
    title: row.title,
    url: row.sourceUrl,
    descriptionHtml: row.descriptionHtml ?? '',
    images: (row.images ?? []) as Array<{ src: string; alt?: string | null }>,
    signals: { tags: (row.tags ?? []) as string[] }
  };
}
