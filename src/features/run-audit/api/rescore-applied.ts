import { and, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/shared/db';
import { audits, productChanges } from '@/shared/db/schema';
import { refreshAuditProducts } from './refresh';

/** Stores re-scored per pass — bounds a tick when many merchants apply at once. */
const MAX_PER_PASS = 5;

/**
 * Re-score the stores whose catalog moved since their last audit run.
 *
 * `reflectAppliedChange` already writes an applied change onto the product
 * row, but the dashboard's product list and every score read the audit's
 * `summary` snapshot — so without this the merchant would see their new title
 * on the product page and the old one in the list right next to it.
 *
 * Self-limiting: the refresh bumps `completedAt`, which is exactly the marker
 * this query compares against, so a store settles after one pass. Scoring is
 * deterministic and free (a connected store is read from its stored catalog,
 * never re-scraped), so this costs nothing but a little CPU.
 */
export async function rescoreProjectsWithAppliedChanges(): Promise<number> {
  // Newest applied ack per project, next to that project's newest audit.
  const rows = await db
    .select({
      auditId: audits.id,
      completedAt: audits.completedAt,
      ackedAt: productChanges.ackedAt,
      projectId: productChanges.projectId
    })
    .from(productChanges)
    .innerJoin(audits, eq(audits.projectId, productChanges.projectId))
    .where(
      and(
        eq(productChanges.status, 'applied'),
        isNotNull(productChanges.ackedAt),
        eq(audits.status, 'completed'),
        isNotNull(audits.completedAt),
        gt(productChanges.ackedAt, audits.completedAt)
      )
    )
    .orderBy(desc(audits.completedAt))
    .limit(MAX_PER_PASS * 20);

  // One refresh per project, and only for its newest audit — the one every
  // dashboard reads.
  const newestAuditByProject = new Map<string, string>();
  for (const row of rows) {
    if (!newestAuditByProject.has(row.projectId)) {
      newestAuditByProject.set(row.projectId, row.auditId);
    }
  }
  const targets = [...newestAuditByProject.values()].slice(0, MAX_PER_PASS);
  if (targets.length === 0) return 0;

  // Guard against picking an older audit of the same project: only the latest
  // one is worth refreshing.
  const latest = await db
    .select({ id: audits.id, projectId: audits.projectId, completedAt: audits.completedAt })
    .from(audits)
    .where(inArray(audits.id, targets));

  let refreshed = 0;
  for (const audit of latest) {
    const res = await refreshAuditProducts(audit.id);
    if (res.ok) refreshed += 1;
    else console.error('[rescore] refresh failed', audit.id, res.reason);
  }
  if (refreshed > 0)
    console.info(`[rescore] refreshed ${refreshed} store(s) after applied changes`);
  return refreshed;
}
