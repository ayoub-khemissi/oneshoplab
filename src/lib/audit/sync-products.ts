import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { products, type Platform } from '@/lib/db/schema';
import type { NormalizedProduct } from '@/lib/adapters/types';

/**
 * 3-way merge between a fresh scrape and the persisted products table for
 * a project. Atomic in a single transaction:
 *
 *   - in BOTH scrape and DB → UPDATE the volatile metadata (title, desc,
 *     images, tags, variants, vendor, type, prices, sourceUrl), bump
 *     `lastSeenAt`, ensure status='active' and clear archivedAt.
 *     `customInstructions` and child jobs are NEVER touched — that's
 *     the merchant's investment.
 *
 *   - in scrape, NOT in DB → INSERT a fresh row, status='active'.
 *
 *   - in DB, NOT in scrape → flip status to 'archived', set archivedAt.
 *     The row + customInstructions + jobs all stay so a re-activation on
 *     the merchant store + re-audit restores everything (status flips
 *     back, lastSeenAt bumps, metadata refreshes).
 *
 * Identity is sourceId-first (stable across renames on every supported
 * platform), handle as a fallback for legacy adapters that didn't emit
 * an ID. Both keys are unique within a project.
 */
export async function syncProjectProducts(
  projectId: string,
  platform: Platform,
  scraped: NormalizedProduct[]
): Promise<{ inserted: number; updated: number; archived: number }> {
  const existing = await db.query.products.findMany({
    where: eq(products.projectId, projectId)
  });

  // Build lookup maps (sourceId / handle → existing row id) so we can
  // resolve each scraped product in O(1) and detect orphans.
  const bySourceId = new Map<string, string>();
  const byHandle = new Map<string, string>();
  for (const e of existing) {
    if (e.sourceId) bySourceId.set(e.sourceId, e.id);
    if (e.handle) byHandle.set(e.handle, e.id);
  }

  const seenIds = new Set<string>();
  const now = new Date();
  let inserted = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const p of scraped) {
      if (!p.sourceId && !p.handle) continue;

      const existingId =
        (p.sourceId && bySourceId.get(p.sourceId)) ||
        (p.handle && byHandle.get(p.handle)) ||
        null;

      if (existingId) {
        seenIds.add(existingId);
        await tx
          .update(products)
          .set({
            // Refresh volatile metadata so renames / desc edits / new
            // images on the merchant side propagate to our UI.
            title: p.title,
            sourceId: p.sourceId,
            sourceUrl: p.sourceUrl,
            handle: p.handle,
            descriptionHtml: p.descriptionHtml,
            images: p.images,
            tags: p.tags,
            variants: p.variants.map((v) => ({
              id: v.id,
              title: v.title,
              price: v.price,
              sku: v.sku,
              available: v.available,
              options: v.options
            })),
            vendor: p.vendor,
            productType: p.productType,
            priceMin: p.priceMin != null ? String(p.priceMin) : null,
            priceMax: p.priceMax != null ? String(p.priceMax) : null,
            currency: p.currency,
            sku: p.sku,
            sourceUpdatedAt: p.sourceUpdatedAt,
            // Confirm presence + un-archive in case it was archived before.
            status: 'active',
            lastSeenAt: now,
            archivedAt: null
          })
          .where(eq(products.id, existingId));
        updated += 1;
      } else {
        const id = randomUUID();
        await tx.insert(products).values({
          id,
          projectId,
          source: platform,
          sourceId: p.sourceId,
          sourceUrl: p.sourceUrl,
          handle: p.handle,
          title: p.title,
          descriptionHtml: p.descriptionHtml,
          images: p.images,
          tags: p.tags,
          variants: p.variants.map((v) => ({
            id: v.id,
            title: v.title,
            price: v.price,
            sku: v.sku,
            available: v.available,
            options: v.options
          })),
          vendor: p.vendor,
          productType: p.productType,
          priceMin: p.priceMin != null ? String(p.priceMin) : null,
          priceMax: p.priceMax != null ? String(p.priceMax) : null,
          currency: p.currency,
          sku: p.sku,
          sourceUpdatedAt: p.sourceUpdatedAt,
          status: 'active',
          lastSeenAt: now
        });
        seenIds.add(id);
        inserted += 1;
      }
    }

    // Soft-archive everything that wasn't seen this round AND is currently
    // active. Already-archived rows stay archived (no-op). The customInstructions
    // and the jobs FK'd to these rows are untouched.
    const orphans = existing.filter(
      (e) => !seenIds.has(e.id) && e.status === 'active'
    );
    if (orphans.length > 0) {
      await tx
        .update(products)
        .set({ status: 'archived', archivedAt: now })
        .where(
          and(
            eq(products.projectId, projectId),
            inArray(
              products.id,
              orphans.map((o) => o.id)
            )
          )
        );
    }
  });

  const archived = existing.filter(
    (e) => !seenIds.has(e.id) && e.status === 'active'
  ).length;

  return { inserted, updated, archived };
}
