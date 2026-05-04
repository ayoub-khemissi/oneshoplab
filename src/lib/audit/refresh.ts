import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits, products } from '@/lib/db/schema';
import { runAudit } from './run';

/** How long an audit's product data is considered fresh before it qualifies
 *  for an automatic background refresh. */
export const AUDIT_FRESH_FOR_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Re-scrape the catalog of an existing audit and update its `summary` JSON
 * with the freshly-computed report (including `allProducts`). Existing
 * dynamic-AI generations are left untouched. No credit cost.
 *
 * Idempotent: running it twice in rapid succession just yields the same
 * fresh data twice. Caller is expected to gate via `AUDIT_FRESH_FOR_MS` if
 * they want to throttle.
 */
export async function refreshAuditProducts(auditId: string): Promise<{
  ok: boolean;
  reason?: string;
  productsFetched?: number;
}> {
  const audit = await db.query.audits.findFirst({ where: eq(audits.id, auditId) });
  if (!audit) return { ok: false, reason: 'audit_not_found' };

  const result = await runAudit(audit.url, { maxProducts: 10000 });
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
    detectedLanguage: r.detectedLanguage
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

  // Mirror new products into the products table so per-product URLs resolve
  // (URLs key off products.id). Existing rows are kept untouched — we only
  // insert what's missing, matched by sourceId/handle.
  if (audit.projectId && result.products.length > 0) {
    const existing = await db.query.products.findMany({
      where: eq(products.projectId, audit.projectId),
      columns: { sourceId: true, handle: true }
    });
    const existingKeys = new Set<string>();
    for (const e of existing) {
      if (e.sourceId) existingKeys.add(`s:${e.sourceId}`);
      if (e.handle) existingKeys.add(`h:${e.handle}`);
    }
    const toInsert = result.products
      .filter((p) => p.sourceId || p.handle)
      .filter((p) => {
        if (p.sourceId && existingKeys.has(`s:${p.sourceId}`)) return false;
        if (p.handle && existingKeys.has(`h:${p.handle}`)) return false;
        return true;
      })
      .map((p) => ({
        id: randomUUID(),
        projectId: audit.projectId!,
        source: result.platform,
        sourceId: p.sourceId,
        sourceUrl: p.sourceUrl,
        handle: p.handle,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        images: p.images,
        tags: p.tags,
        variants: p.variants
      }));
    if (toInsert.length > 0) {
      await db.insert(products).values(toInsert);
    }
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
  const latest = await db.query.audits.findFirst({
    where: eq(audits.projectId, projectId),
    orderBy: [desc(audits.createdAt)]
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
