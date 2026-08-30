/**
 * Admin GraphQL product (2025-07) → OSL NormalizedProduct. Same field
 * conventions as the storefront adapter (entities/store-adapter/api/shopify.ts):
 * numeric ids (no gid prefix) so rows synced by scraping and by the
 * connector share one `sourceId`, prices in major units, tags trimmed.
 */
import {
  normalizeTags,
  type NormalizedProduct,
  type ProductImage,
  type ProductVariant
} from '@/entities/store-adapter';

export interface AdminSelectedOption {
  name: string;
  value: string;
}
export interface AdminVariant {
  id: string;
  title: string | null;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  selectedOptions: AdminSelectedOption[];
}
export interface AdminMediaImage {
  id: string;
  alt: string | null;
  image: { url: string; width: number | null; height: number | null } | null;
}
export interface AdminProduct {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  updatedAt: string;
  onlineStoreUrl: string | null;
  variants: { nodes: AdminVariant[] };
  media: { nodes: Array<AdminMediaImage | Record<string, never>> };
}

/** Requested cost must stay ≤ 1000 points: 20 × (1 + 10 variants + 10 media × 2) ≈ 620. */
export const PRODUCTS_PAGE_SIZE = 20;
export const VARIANTS_FIRST = 10;
export const MEDIA_FIRST = 10;

export const PRODUCT_FIELDS_FRAGMENT = `
fragment OslProduct on Product {
  id title handle descriptionHtml vendor productType tags updatedAt onlineStoreUrl
  variants(first: ${VARIANTS_FIRST}) {
    nodes { id title sku price availableForSale selectedOptions { name value } }
  }
  media(first: ${MEDIA_FIRST}) {
    nodes { ... on MediaImage { id alt image { url width height } } }
  }
}`;

const GID_RE = /^gid:\/\/shopify\/\w+\/(\d+)$/;

export function sourceIdFromGid(gid: string): string {
  const m = GID_RE.exec(gid);
  return m ? m[1] : gid;
}

export function productGid(sourceId: string): string {
  return sourceId.startsWith('gid://') ? sourceId : `gid://shopify/Product/${sourceId}`;
}

export interface MapContext {
  shopDomain: string;
  currency: string | null;
}

function isMediaImage(m: AdminMediaImage | Record<string, never>): m is AdminMediaImage {
  return typeof (m as AdminMediaImage).id === 'string';
}

export function mapAdminProduct(p: AdminProduct, ctx: MapContext): NormalizedProduct {
  const variants: ProductVariant[] = (p.variants?.nodes ?? []).map((v) => {
    const id = sourceIdFromGid(v.id);
    const options: Record<string, string> = {};
    for (const o of v.selectedOptions ?? []) if (o.name && o.value) options[o.name] = o.value;
    return {
      id,
      sourceVariantId: id,
      title: v.title && v.title !== 'Default Title' ? v.title : null,
      sku: v.sku || null,
      price: parseFloat(v.price) || 0,
      available: !!v.availableForSale,
      options
    };
  });
  const prices = variants.map((v) => v.price).filter((n) => Number.isFinite(n) && n > 0);

  const images: ProductImage[] = [];
  for (const m of p.media?.nodes ?? []) {
    if (!isMediaImage(m) || !m.image?.url) continue;
    images.push({
      src: m.image.url,
      alt: m.alt || null,
      width: m.image.width ?? null,
      height: m.image.height ?? null,
      position: images.length
    });
  }

  return {
    source: 'shopify',
    sourceId: sourceIdFromGid(p.id),
    sourceUrl: p.onlineStoreUrl ?? `https://${ctx.shopDomain}/products/${p.handle}`,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml ?? '',
    images,
    tags: normalizeTags((p.tags ?? []).map((t) => t.trim())),
    variants,
    vendor: p.vendor || null,
    productType: p.productType || null,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    currency: ctx.currency,
    sku: variants.find((v) => v.sku)?.sku ?? null,
    sourceUpdatedAt: p.updatedAt ? new Date(p.updatedAt) : null
  };
}
