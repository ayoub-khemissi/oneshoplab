import type { NormalizedProduct } from '@/entities/store-adapter';
import type { Platform, products } from '@/shared/db/schema';

export type ProductRow = typeof products.$inferSelect;

export interface ProductRowToNormalizedOptions {
  /** Override the platform stored on the row (manual recomputes force 'manual'). */
  source?: Platform;
  /** Used when the row has no `sourceId` — manual products key on the row id. */
  sourceIdFallback?: string;
  /** Used when the row carries no store-side update date (manual products). */
  sourceUpdatedAtFallback?: Date | null;
}

/**
 * `products` row → the `NormalizedProduct` shape the adapters emit and the
 * scorer consumes. The inverse of what `syncProjectProducts` persists, so
 * anything that already owns the catalog (a connected store, a from-scratch
 * project) can be scored without re-fetching it.
 *
 * Two fields cannot round-trip because the table does not store them:
 *   - `variants[].sourceVariantId` (dropped on write) → always null here;
 *   - image `position` when the stored image predates the column → index.
 * `sourceImageId` DOES round-trip: it is what image ops target, and losing
 * it silently degrades every op to replace-all (docs/api/IMAGE-OPS.md §1).
 */
export function productRowToNormalized(
  row: ProductRow,
  options: ProductRowToNormalizedOptions = {}
): NormalizedProduct {
  return {
    source: options.source ?? row.source,
    sourceId: row.sourceId ?? options.sourceIdFallback ?? null,
    sourceUrl: row.sourceUrl,
    handle: row.handle,
    title: row.title,
    descriptionHtml: row.descriptionHtml ?? '',
    images: (row.images ?? []).map((img, i) => ({
      src: img.src,
      alt: img.alt ?? null,
      width: img.width ?? null,
      height: img.height ?? null,
      position: img.position ?? i,
      sourceImageId: img.sourceImageId ?? null
    })),
    tags: row.tags ?? [],
    variants: (row.variants ?? []).map((v) => ({
      id: v.id,
      sourceVariantId: null,
      title: v.title ?? null,
      sku: v.sku ?? null,
      price: v.price,
      available: v.available,
      options: v.options ?? {}
    })),
    vendor: row.vendor ?? null,
    productType: row.productType ?? null,
    // MySQL DECIMAL comes back as a string; the scorer and the summary
    // expect numbers.
    priceMin: row.priceMin != null ? Number(row.priceMin) : null,
    priceMax: row.priceMax != null ? Number(row.priceMax) : null,
    currency: row.currency ?? null,
    sku: row.sku ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt ?? options.sourceUpdatedAtFallback ?? null
  };
}
