import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { runDynamicAuditForProduct } from '@/lib/ai';
import { db } from '@/lib/db';
import { audits, products } from '@/lib/db/schema';
import { runAudit } from './run';

const DYNAMIC_AUDIT_PRODUCTS = 3;

/**
 * Process a pending audit row:
 *   1. Detect platform, fetch the catalog, compute the static rule-based
 *      report (scores, distribution, worst/best/latest products).
 *   2. Run the AI dynamic audit on the 3 most recently posted products:
 *      one Claude chat each (sync) for SEO rewrite + Instagram post,
 *      plus three image-to-image generations each (async via webhook).
 *   3. Persist the audit row as `completed`.
 *
 * Idempotent against double runs — only acts when the row is `pending`.
 */
export async function processAudit(auditId: string): Promise<void> {
  const row = await db.query.audits.findFirst({ where: eq(audits.id, auditId) });
  if (!row || row.status !== 'pending') return;

  await db
    .update(audits)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(audits.id, auditId));

  try {
    const result = await runAudit(row.url, { maxProducts: 10000 });
    const isFailure = !result.report && result.error;

    // Mirror fetched products into the `products` table so per-product URLs
    // (which key off `products.id`) resolve. We only persist when we have a
    // project link and at least one product, and we skip rows that already
    // exist (matched by sourceId — adapters emit stable platform IDs).
    if (row.projectId && result.products.length > 0) {
      const existing = await db.query.products.findMany({
        where: eq(products.projectId, row.projectId),
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
          projectId: row.projectId!,
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

    // ---- AI dynamic audit on the 3 latest products ------------------------
    // We await the chat calls so the audit isn't marked completed until
    // the AI text suggestions are persisted. Image jobs fire asynchronously
    // and resolve later via the kie webhook.
    if (result.report && result.report.latestProducts.length > 0) {
      const language = result.report.detectedLanguage;
      const platform = result.platform;
      const appUrl = process.env.APP_URL ?? null;

      await Promise.allSettled(
        result.report.latestProducts.slice(0, DYNAMIC_AUDIT_PRODUCTS).map((p) =>
          runDynamicAuditForProduct({
            auditId,
            platform,
            language,
            appUrl,
            product: {
              sourceId: p.sourceId,
              title: p.title,
              descriptionHtml: p.descriptionHtml,
              tags: p.signals.tags ?? [],
              vendor: p.signals.vendor,
              productType: p.signals.productType,
              priceMin: p.signals.priceMin,
              priceMax: p.signals.priceMax,
              currency: null,
              images: p.images.map((i) => ({ src: i.src, alt: i.alt }))
            }
          })
        )
      );
    }

    await db
      .update(audits)
      .set({
        status: isFailure ? 'failed' : 'completed',
        platform: result.platform,
        scores: result.report ? result.report.scores : null,
        summary: result.report
          ? {
              avgProductScore: result.report.avgProductScore,
              averages: result.report.averages,
              lastProductUpdated: result.report.lastProductUpdated,
              lowResImageCount: result.report.lowResImageCount,
              distribution: result.report.distribution,
              topVendors: result.report.topVendors,
              topProductTypes: result.report.topProductTypes,
              topTags: result.report.topTags,
              worstProducts: result.report.worstProducts,
              bestProducts: result.report.bestProducts,
              latestProducts: result.report.latestProducts,
              allProducts: result.report.allProducts,
              detectedLanguage: result.report.detectedLanguage,
              detectionSignals: result.detectionSignals,
              detectionConfidence: result.detectionConfidence
            }
          : null,
        productsSampled: result.productsFetched,
        error: result.error,
        completedAt: new Date()
      })
      .where(eq(audits.id, auditId));
  } catch (e) {
    await db
      .update(audits)
      .set({
        status: 'failed',
        error: (e as Error).message,
        completedAt: new Date()
      })
      .where(eq(audits.id, auditId));
  }
}
