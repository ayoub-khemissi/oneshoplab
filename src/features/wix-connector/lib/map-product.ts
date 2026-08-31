/**
 * Wix Stores v1 product → OSL NormalizedProduct. Same conventions as the
 * storefront adapter (entities/store-adapter/api/wix.ts): prices in major
 * units, images with alt, sourceId = Wix product id. Wix has no tags: the
 * ribbon is exposed as the single tag; the first collection name as
 * productType.
 */
import { normalizeTags, type NormalizedProduct, type ProductImage } from '@/entities/store-adapter';

export interface WixMediaItem {
  id?: string;
  title?: string;
  mediaType?: string;
  image?: { url?: string; width?: number; height?: number };
}
export interface WixVariant {
  id: string;
  choices?: Record<string, string>;
  variant?: { priceData?: { price?: number }; sku?: string; visible?: boolean };
  stock?: { inStock?: boolean };
}
export interface WixProduct {
  id: string;
  name: string;
  slug?: string;
  visible?: boolean;
  productType?: string;
  description?: string;
  sku?: string;
  brand?: string;
  ribbon?: string;
  priceData?: { currency?: string; price?: number };
  priceRange?: { minValue?: number; maxValue?: number };
  media?: { items?: WixMediaItem[] };
  productPageUrl?: { base?: string; path?: string };
  collectionIds?: string[];
  variants?: WixVariant[];
  lastUpdated?: string;
  stock?: { inStock?: boolean };
}

/** Wix caps `paging.limit` at 100 for the products query. */
export const WIX_PRODUCTS_PAGE_SIZE = 100;
/** Ribbon max length in the Wix dashboard. */
export const WIX_RIBBON_MAX = 30;

export interface WixMapContext {
  /** collection id → name (pull fetches them once; webhooks may pass an empty map). */
  collections: ReadonlyMap<string, string>;
}

function joinUrl(base: string | undefined, path: string | undefined): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${(path ?? '').replace(/^\/+/, '')}`;
}

export function mapWixProduct(p: WixProduct, ctx: WixMapContext): NormalizedProduct {
  const currency = p.priceData?.currency ?? null;
  const variants = (p.variants ?? []).map((v) => ({
    id: v.id,
    sourceVariantId: v.id,
    title: v.choices ? Object.values(v.choices).join(' / ') || null : null,
    sku: v.variant?.sku || null,
    price: Number(v.variant?.priceData?.price ?? p.priceData?.price ?? 0) || 0,
    available: v.stock?.inStock ?? p.stock?.inStock ?? true,
    options: v.choices ?? {}
  }));
  const images: ProductImage[] = [];
  for (const m of p.media?.items ?? []) {
    if (!m.image?.url) continue;
    images.push({
      src: m.image.url,
      alt: m.title || null,
      width: m.image.width ?? null,
      height: m.image.height ?? null,
      position: images.length,
      // Wix media id — what the remove call targets (IMAGE-OPS.md §1). Some
      // legacy items come back without one: null, never invented.
      sourceImageId: m.id ?? null
    });
  }
  const priceMin = p.priceRange?.minValue ?? p.priceData?.price ?? null;
  const priceMax = p.priceRange?.maxValue ?? p.priceData?.price ?? null;
  const collectionName = (p.collectionIds ?? [])
    .map((id) => ctx.collections.get(id))
    .find((n): n is string => !!n);
  return {
    source: 'wix',
    sourceId: p.id,
    sourceUrl: joinUrl(p.productPageUrl?.base, p.productPageUrl?.path),
    handle: p.slug ?? null,
    title: p.name,
    descriptionHtml: p.description ?? '',
    images,
    tags: normalizeTags(p.ribbon ? [p.ribbon.trim()] : []),
    variants,
    vendor: p.brand || null,
    productType: collectionName ?? null,
    priceMin: priceMin !== null && priceMin > 0 ? priceMin : null,
    priceMax: priceMax !== null && priceMax > 0 ? priceMax : null,
    currency,
    sku: p.sku || variants.find((v) => v.sku)?.sku || null,
    sourceUpdatedAt: p.lastUpdated ? new Date(p.lastUpdated) : null
  };
}
