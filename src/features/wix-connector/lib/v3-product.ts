import type { WixProduct } from './map-product';

/**
 * Catalog V3 → the V1-shaped `WixProduct` the rest of the connector maps from.
 *
 * Wix Stores has two catalogues that are not compatible: V1 (the API this
 * connector was written against) and V3, which every new site is on and every
 * old one will migrate to. Rather than teach the mapper, the pull, the apply
 * loop and the image ops two schemas, V3 products are folded into the V1
 * shape at the client boundary. What V3 adds that V1 lacked travels in the
 * optional fields below.
 */

/** What we ask V3 to include; everything else is off by default. */
export const V3_PRODUCT_FIELDS = [
  'PLAIN_DESCRIPTION',
  'MEDIA_ITEMS_INFO',
  'URL',
  'CURRENCY',
  'BREADCRUMBS_INFO'
] as const;

export interface V3Product {
  id: string;
  revision?: string;
  name?: string;
  slug?: string;
  visible?: boolean;
  productType?: string;
  plainDescription?: string;
  updatedDate?: string;
  currency?: string;
  url?: { url?: string; relativePath?: string };
  ribbon?: { id?: string; name?: string } | null;
  additionalRibbons?: Array<{ id?: string; name?: string }>;
  brand?: { id?: string; name?: string } | null;
  actualPriceRange?: {
    minValue?: { amount?: string };
    maxValue?: { amount?: string };
  };
  media?: {
    itemsInfo?: {
      items?: Array<{
        id?: string;
        url?: string;
        altText?: string;
        image?: { id?: string; url?: string; width?: number; height?: number; altText?: string };
      }>;
    };
  };
  categories?: string[];
  breadcrumbsInfo?: { items?: Array<{ id?: string; name?: string; slug?: string }> };
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export function fromV3Product(p: V3Product): WixProduct {
  const min = num(p.actualPriceRange?.minValue?.amount);
  const max = num(p.actualPriceRange?.maxValue?.amount);
  const crumbs = p.breadcrumbsInfo?.items ?? [];
  // Breadcrumbs run root → the product's own category: the last one is the
  // one a merchant would call "the" category.
  const categoryName = crumbs.length > 0 ? crumbs[crumbs.length - 1]?.name : undefined;
  return {
    id: p.id,
    name: p.name ?? '',
    slug: p.slug,
    visible: p.visible,
    productType: p.productType,
    description: p.plainDescription ?? '',
    brand: p.brand?.name ?? undefined,
    ribbon: p.ribbon?.name ?? undefined,
    additionalRibbons: (p.additionalRibbons ?? [])
      .map((r) => r.name)
      .filter((n): n is string => !!n),
    priceData: { currency: p.currency, price: min },
    priceRange:
      min !== undefined || max !== undefined ? { minValue: min, maxValue: max } : undefined,
    media: {
      items: (p.media?.itemsInfo?.items ?? []).map((m) => ({
        id: m.id ?? m.image?.id,
        title: m.altText ?? m.image?.altText,
        mediaType: 'image',
        image: { url: m.image?.url ?? m.url, width: m.image?.width, height: m.image?.height }
      }))
    },
    pageUrl: p.url?.url,
    collectionIds: p.categories ?? [],
    categoryName,
    variants: [],
    lastUpdated: p.updatedDate,
    revision: p.revision
  };
}
