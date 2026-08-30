import type { NormalizedProduct } from '@/entities/store-adapter';
import type { Platform } from '@/shared/db/schema';
import type { SyncProductInput } from './schema';

/** Plugin payload → the adapter shape `syncProjectProducts` persists. */
export function toNormalizedProduct(p: SyncProductInput, platform: Platform): NormalizedProduct {
  return {
    source: platform,
    sourceId: p.sourceId,
    sourceUrl: p.sourceUrl ?? null,
    handle: p.handle ?? null,
    title: p.title,
    descriptionHtml: p.descriptionHtml ?? '',
    images: (p.images ?? []).map((img, i) => ({
      src: img.src,
      alt: img.alt ?? null,
      width: img.width ?? null,
      height: img.height ?? null,
      position: img.position ?? i
    })),
    tags: p.tags ?? [],
    variants: (p.variants ?? []).map((v) => ({
      id: v.id,
      sourceVariantId: v.sourceVariantId ?? null,
      title: v.title ?? null,
      sku: v.sku ?? null,
      price: v.price,
      available: v.available,
      options: v.options ?? {}
    })),
    vendor: p.vendor ?? null,
    productType: p.productType ?? null,
    priceMin: p.priceMin ?? null,
    priceMax: p.priceMax ?? null,
    currency: p.currency ?? null,
    sku: p.sku ?? null,
    sourceUpdatedAt: p.sourceUpdatedAt ? new Date(p.sourceUpdatedAt) : null
  };
}
