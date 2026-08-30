import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { NormalizedProduct } from '@/entities/store-adapter';
import { db } from '@/lib/db';
import { audits, products } from '@/lib/db/schema';
import { audit as runScore } from '@/entities/audit';

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

  // products row → NormalizedProduct shape. Most fields map 1:1; the
  // few we synthesise are `position` on images (kept by insertion
  // order) and parsing the decimal price columns back to numbers.
  const normalized: NormalizedProduct[] = rows.map((p, idx) => ({
    source: 'manual',
    sourceId: p.sourceId ?? p.id,
    sourceUrl: p.sourceUrl,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml ?? '',
    images: (p.images ?? []).map((img, i) => ({
      src: img.src,
      alt: img.alt ?? null,
      width: img.width ?? null,
      height: img.height ?? null,
      position: i
    })),
    tags: p.tags ?? [],
    variants: (p.variants ?? []).map((v) => ({
      id: v.id,
      sourceVariantId: null,
      title: v.title ?? null,
      sku: v.sku ?? null,
      price: v.price,
      available: v.available,
      options: v.options ?? {}
    })),
    vendor: p.vendor ?? null,
    productType: p.productType ?? null,
    priceMin: p.priceMin != null ? Number(p.priceMin) : null,
    priceMax: p.priceMax != null ? Number(p.priceMax) : null,
    currency: p.currency ?? null,
    sku: p.sku ?? null,
    // Use updatedAt so "latestProducts" picks the most-recently-edited
    // products for the dynamic-audit slot in the future. Order in the
    // table is otherwise arbitrary. Use idx as a tiebreaker bias.
    sourceUpdatedAt: p.updatedAt ?? new Date(Date.now() - idx)
  }));

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
