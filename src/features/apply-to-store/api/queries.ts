import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/shared/db';
import { productChanges, products } from '@/shared/db/schema';
import { toChangeSummary } from '../lib/summary';
import type { ChangeSummary, PendingChangeSummary } from '../model/types';

const PENDING_LIST_LIMIT = 100;

/** Latest change per source job — drives the Apply button state on the product page. */
export async function listChangesForJobs(
  projectId: string,
  jobIds: string[]
): Promise<Record<string, ChangeSummary>> {
  if (jobIds.length === 0) return {};
  const rows = await db
    .select()
    .from(productChanges)
    .where(
      and(eq(productChanges.projectId, projectId), inArray(productChanges.sourceJobId, jobIds))
    )
    .orderBy(desc(productChanges.id));
  const out: Record<string, ChangeSummary> = {};
  for (const row of rows) {
    if (row.sourceJobId && !(row.sourceJobId in out)) out[row.sourceJobId] = toChangeSummary(row);
  }
  return out;
}

/** Integrations tab: what the plugin still has to pick up, plus conflicts to review. */
export async function listPendingChangesForSite(
  projectId: string
): Promise<PendingChangeSummary[]> {
  const rows = await db
    .select({ change: productChanges, productTitle: products.title })
    .from(productChanges)
    .innerJoin(products, eq(products.id, productChanges.productId))
    .where(
      and(
        eq(productChanges.projectId, projectId),
        inArray(productChanges.status, ['pending', 'conflict', 'failed'])
      )
    )
    .orderBy(desc(productChanges.id))
    .limit(PENDING_LIST_LIMIT);
  return rows.map((r) => ({
    ...toChangeSummary(r.change),
    productId: r.change.productId,
    productTitle: r.productTitle,
    field: r.change.field
  }));
}
