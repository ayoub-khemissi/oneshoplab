import { and, desc, eq, isNotNull, max } from 'drizzle-orm';
import { findLatestAuditIdWhere } from '@/entities/audit';
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
 * The audit refreshed is the one every dashboard reads: newest by
 * `createdAt`, exactly like `findLatestAuditIdWhere`. Refreshing any other row
 * of the same project would bump a snapshot nobody looks at and leave the
 * visible one stale for good.
 *
 * Self-limiting: the refresh bumps that audit's `completedAt`, which is the
 * marker this compares against, so a store settles after one pass. Scoring is
 * deterministic and free (a connected store is read from its stored catalog,
 * never re-scraped), so this costs nothing but a little CPU.
 */
export async function rescoreProjectsWithAppliedChanges(): Promise<number> {
  const candidates = await db
    .select({
      projectId: productChanges.projectId,
      lastAckedAt: max(productChanges.ackedAt)
    })
    .from(productChanges)
    .where(and(eq(productChanges.status, 'applied'), isNotNull(productChanges.ackedAt)))
    .groupBy(productChanges.projectId)
    .orderBy(desc(max(productChanges.ackedAt)))
    .limit(MAX_PER_PASS * 20);

  let refreshed = 0;
  for (const candidate of candidates) {
    if (refreshed >= MAX_PER_PASS) break;
    const auditId = await findLatestAuditIdWhere(
      and(eq(audits.projectId, candidate.projectId), eq(audits.status, 'completed'))!
    );
    if (!auditId) continue;
    const [audit] = await db
      .select({ completedAt: audits.completedAt })
      .from(audits)
      .where(eq(audits.id, auditId));
    // Already scored after the last change landed: nothing to redo.
    if (
      !candidate.lastAckedAt ||
      (audit?.completedAt && audit.completedAt >= candidate.lastAckedAt)
    ) {
      continue;
    }
    const res = await refreshAuditProducts(auditId);
    if (res.ok) refreshed += 1;
    else console.error('[rescore] refresh failed', auditId, res.reason);
  }
  if (refreshed > 0)
    console.info(`[rescore] refreshed ${refreshed} store(s) after applied changes`);
  return refreshed;
}
