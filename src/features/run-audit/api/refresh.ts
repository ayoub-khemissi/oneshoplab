import { eq } from 'drizzle-orm';
import { db } from '@/shared/db';
import { audits } from '@/shared/db/schema';
import { findLatestAuditIdWhere } from '@/entities/audit';
import { auditSourceSummary, runAuditForProject, type AuditRunOptions } from './catalog-audit';
import { syncProjectProducts } from '@/entities/product';

/** How long an audit's product data is considered fresh before it qualifies
 *  for an automatic background refresh. */
export const AUDIT_FRESH_FOR_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Re-read the catalog of an existing audit and update its `summary` JSON
 * with the freshly-computed report (including `allProducts`). Existing
 * dynamic-AI generations are left untouched. No credit cost.
 *
 * Same source selection as `processAudit`: a connected project is scored
 * from its stored catalog and never re-scraped, so the daily dashboard
 * refresh cannot overwrite what the connection provided either.
 *
 * Idempotent: running it twice in rapid succession just yields the same
 * fresh data twice. Caller is expected to gate via `AUDIT_FRESH_FOR_MS` if
 * they want to throttle.
 */
export async function refreshAuditProducts(
  auditId: string,
  options: { catalogWait?: AuditRunOptions['catalogWait'] } = {}
): Promise<{
  ok: boolean;
  reason?: string;
  productsFetched?: number;
}> {
  const audit = await db.query.audits.findFirst({ where: eq(audits.id, auditId) });
  if (!audit) return { ok: false, reason: 'audit_not_found' };

  const result = await runAuditForProject(audit.projectId, audit.url, {
    maxProducts: 10000,
    catalogWait: options.catalogWait
  });
  if (!result.report) {
    return { ok: false, reason: result.error ?? 'no_report' };
  }
  const r = result.report;
  const existingSummary = (audit.summary ?? {}) as Record<string, unknown>;
  const newSummary = {
    ...existingSummary,
    avgProductScore: r.avgProductScore,
    averages: r.averages,
    lastProductUpdated: r.lastProductUpdated,
    lowResImageCount: r.lowResImageCount,
    distribution: r.distribution,
    topVendors: r.topVendors,
    topProductTypes: r.topProductTypes,
    topTags: r.topTags,
    worstProducts: r.worstProducts,
    bestProducts: r.bestProducts,
    latestProducts: r.latestProducts,
    allProducts: r.allProducts,
    detectedLanguage: r.detectedLanguage,
    ...auditSourceSummary(result)
  };

  await db
    .update(audits)
    .set({
      scores: r.scores,
      summary: newSummary,
      productsSampled: result.productsFetched,
      // Bump completedAt — the dashboard uses it as the "data freshness"
      // signal to decide whether the next visit should auto-refresh again.
      completedAt: new Date()
    })
    .where(eq(audits.id, auditId));

  // 3-way merge between scrape and DB — see syncProjectProducts for the
  // full contract. Same code path as the initial processAudit run; refresh
  // is essentially "sync without re-scoring". Scrapes only: a connected
  // catalog is already the table (see processAudit).
  if (audit.projectId && result.source === 'storefront' && result.products.length > 0) {
    await syncProjectProducts(audit.projectId, result.platform, result.products);
  }

  return { ok: true, productsFetched: result.productsFetched };
}

/**
 * Find the latest audit for a project and refresh it if its data is older
 * than `AUDIT_FRESH_FOR_MS`. Used by the dashboard to keep product data in
 * sync with the source store on a daily basis without burning AI credits.
 *
 * Returns whether a refresh actually ran (false when data was still fresh
 * enough or the project has no completed audit).
 */
export async function refreshProjectIfStale(
  projectId: string
): Promise<{ refreshed: boolean; reason?: string }> {
  const latestId = await findLatestAuditIdWhere(eq(audits.projectId, projectId));
  if (!latestId) return { refreshed: false, reason: 'no_audit' };
  // Re-fetch only the small fields we need to gate on. Skipping
  // `summary` / `scores` keeps this query fast even on big catalogs.
  const latest = await db.query.audits.findFirst({
    where: eq(audits.id, latestId),
    columns: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true
    }
  });
  if (!latest) return { refreshed: false, reason: 'no_audit' };
  if (latest.status !== 'completed') return { refreshed: false, reason: 'not_completed' };

  const last = latest.completedAt ?? latest.createdAt;
  if (last && Date.now() - new Date(last).getTime() < AUDIT_FRESH_FOR_MS) {
    return { refreshed: false, reason: 'fresh' };
  }

  const result = await refreshAuditProducts(latest.id);
  return { refreshed: result.ok, reason: result.reason };
}
