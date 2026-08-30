import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { products, type Platform } from '@/lib/db/schema';
import type { NormalizedProduct } from '@/entities/store-adapter';

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
  const existingById = new Map<string, (typeof existing)[number]>();
  for (const e of existing) {
    existingById.set(e.id, e);
    if (e.sourceId) bySourceId.set(e.sourceId, e.id);
    if (e.handle) byHandle.set(e.handle, e.id);
  }

  const seenIds = new Set<string>();
  const now = new Date();
  let inserted = 0;
  let updated = 0;

  // Two-pass match: sourceId-first across the whole scrape, then
  // handle for whatever's left. Some platforms (WooCommerce sites
  // with rich-snippet collisions, or shops that recycle slugs after
  // a delete-and-recreate) emit the same handle for many distinct
  // products in a single scrape. Without this two-pass approach we
  // would update the same DB row N times — once per duplicate-handle
  // scraped product — and the row's sourceId ends up at whichever
  // duplicate was iterated last, silently breaking history lookups
  // against jobs.input_payload.productSourceId.
  const claimed = new Set<string>();
  const reservations = new Map<NormalizedProduct, string | null>();

  // Pass 1: every scrape entry that has a direct sourceId match.
  for (const p of scraped) {
    if (!p.sourceId) continue;
    const id = bySourceId.get(p.sourceId);
    if (id && !claimed.has(id)) {
      claimed.add(id);
      reservations.set(p, id);
    }
  }
  // Pass 2: handle fallback for whatever didn't claim a sourceId
  // match. We only let ONE scrape entry win each handle, breaking
  // the duplicate-handle merge collision.
  const claimedHandles = new Set<string>();
  for (const p of scraped) {
    if (reservations.has(p)) continue;
    if (!p.handle) continue;
    if (claimedHandles.has(p.handle)) continue;
    const id = byHandle.get(p.handle);
    if (id && !claimed.has(id)) {
      claimed.add(id);
      claimedHandles.add(p.handle);
      reservations.set(p, id);
    }
  }

  await db.transaction(async (tx) => {
    for (const p of scraped) {
      if (!p.sourceId && !p.handle) continue;

      const existingId = reservations.get(p) ?? null;

      if (existingId) {
        seenIds.add(existingId);
        // A merchant-initiated archive is sticky: even though the
        // product is back in the scrape, keep it archived (and keep
        // its archivedAt) until they explicitly restore it. Auto-
        // archived rows un-archive normally.
        const prev = existingById.get(existingId);
        const keepArchived = prev?.manuallyArchived === true;
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
            // Confirm presence + un-archive in case it was archived before
            // (unless the merchant manually archived it — that's sticky).
            status: keepArchived ? 'archived' : 'active',
            lastSeenAt: now,
            archivedAt: keepArchived ? (prev?.archivedAt ?? now) : null
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
    const orphans = existing.filter((e) => !seenIds.has(e.id) && e.status === 'active');
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

  const archived = existing.filter((e) => !seenIds.has(e.id) && e.status === 'active').length;

  return { inserted, updated, archived };
}
