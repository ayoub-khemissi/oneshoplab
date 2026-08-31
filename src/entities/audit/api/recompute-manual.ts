import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { productRowToNormalized } from '@/entities/product';
import type { NormalizedProduct } from '@/entities/store-adapter';
import { db } from '@/shared/db';
import { audits, products } from '@/shared/db/schema';
import { audit as runScore } from '../lib/score';

/**
 * Re-compute the audit summary for a from-scratch ("manual") project.
 *
 * Unlike scraped projects, there's no remote catalog to fetch — the
 * canonical list of products lives in our `products` table. We map
 * those rows into NormalizedProduct shape, run the score pipeline
 * with `skipAltText: true` (the user uploaded the images themselves,
 * we don't audit them on alt-text coverage), then upsert the latest
 * audits row with platform='manual'.
 *
 * Idempotent — runs cheaply (no HTTP, no LLM) so it can be triggered
 * fire-and-forget after every product mutation.
 */
export async function recomputeManualAudit(projectId: string): Promise<void> {
  const rows = await db.query.products.findMany({
    where: and(eq(products.projectId, projectId), eq(products.status, 'active'))
  });

  // products row → NormalizedProduct shape (the shared mapper: the same
  // one the connected-catalog audit uses). Manual rows never carry a
  // store-side update date, so we fall back to `updatedAt` — that way
  // "latestProducts" lists the most-recently-edited products. Order in the
  // table is otherwise arbitrary, hence the idx tiebreaker bias.
  const normalized: NormalizedProduct[] = rows.map((p, idx) =>
    productRowToNormalized(p, {
      source: 'manual',
      sourceIdFallback: p.id,
      sourceUpdatedAtFallback: p.updatedAt ?? new Date(Date.now() - idx)
    })
  );

  const report = runScore(normalized, { skipAltText: true });

  // Latest audit row for this project (we re-use it across recomputes
  // rather than appending a new audit each time — manual recomputes
  // are cheap and there's no historical value to track per snapshot).
  const latest = await db.query.audits.findFirst({
    where: eq(audits.projectId, projectId),
    orderBy: [desc(audits.createdAt)],
    columns: { id: true }
  });

  const summary = {
    avgProductScore: report.avgProductScore,
    averages: report.averages,
    lastProductUpdated: report.lastProductUpdated,
    lowResImageCount: report.lowResImageCount,
    distribution: report.distribution,
    topVendors: report.topVendors,
    topProductTypes: report.topProductTypes,
    topTags: report.topTags,
    worstProducts: report.worstProducts,
    bestProducts: report.bestProducts,
    latestProducts: report.latestProducts,
    allProducts: report.allProducts,
    detectedLanguage: null,
    detectionSignals: [],
    detectionConfidence: 1
  };

  const now = new Date();
  if (latest) {
    await db
      .update(audits)
      .set({
        status: 'completed',
        platform: 'manual',
        scores: report.scores,
        summary,
        productsSampled: normalized.length,
        error: null,
        startedAt: now,
        completedAt: normalized.length > 0 ? now : null
      })
      .where(eq(audits.id, latest.id));
  } else {
    // No prior audit (first-ever recompute on a freshly created
    // manual project). Insert a synthetic row with shim domain/url
    // because the columns are notNull.
    await db.insert(audits).values({
      id: randomUUID(),
      url: '(manual)',
      domain: '(manual)',
      projectId,
      platform: 'manual',
      status: 'completed',
      scores: report.scores,
      summary,
      productsSampled: normalized.length,
      startedAt: now,
      completedAt: normalized.length > 0 ? now : null
    });
  }
}
