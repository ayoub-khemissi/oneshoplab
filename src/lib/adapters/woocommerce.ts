import type {
  AdapterContext,
  FetchOptions,
  NormalizedProduct,
  PlatformAdapter,
  PlatformDetection,
  ProductImage,
  ProductVariant
} from './types';
import { decodeHtmlEntities, fetchJson, normalizeTags, rootOf } from './fetch-utils';

const PAGE_SIZE = 100;

interface WcStoreImage {
  id: number;
  src: string;
  thumbnail: string;
  alt: string;
  name: string;
  srcset: string;
}

interface WcStorePrices {
  price: string;
  regular_price: string;
  sale_price: string;
  currency_code: string;
  currency_minor_unit: number;
}

interface WcStoreCategory {
  id: number;
  name: string;
  slug: string;
}

interface WcStoreBrand {
  id: number;
  name: string;
  slug: string;
}

interface WcStoreVariation {
  id: number;
  attributes: { name: string; value: string }[];
}

interface WcStoreProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  type: string;
  sku: string;
  short_description: string;
  description: string;
  on_sale: boolean;
  prices: WcStorePrices;
  images: WcStoreImage[];
  categories?: WcStoreCategory[];
  tags?: { id: number; name: string; slug: string }[];
  brands?: WcStoreBrand[];
  variations?: WcStoreVariation[];
  is_in_stock: boolean;
  is_purchasable: boolean;
}

export const woocommerceAdapter: PlatformAdapter = {
  name: 'woocommerce',

  async detect(ctx: AdapterContext): Promise<PlatformDetection> {
    const signals: string[] = [];
    let confidence = 0;

    if (ctx.homeHtml) {
      if (/<meta[^>]+content=["']WordPress[^"']*["']/i.test(ctx.homeHtml)) {
        signals.push('WordPress generator meta');
        confidence += 0.2;
      }
      if (/wp-content|wp-includes|\/wp\/wp-includes/.test(ctx.homeHtml)) {
        signals.push('wp-content/includes paths');
        confidence += 0.1;
      }
      if (/woocommerce/i.test(ctx.homeHtml)) {
        signals.push('woocommerce markers in HTML');
        confidence += 0.3;
      }
      if (/\/(?:content\/|wp-content\/|app\/)plugins\/woocommerce\//.test(ctx.homeHtml)) {
        signals.push('woocommerce plugin assets loaded');
        confidence += 0.3;
      }
    }

    // Definitive: GET /wp-json/wc/store/v1/products?per_page=1 returns array
    const root = rootOf(ctx.url);
    const probe = await fetchJson<unknown>(`${root}/wp-json/wc/store/v1/products?per_page=1`);
    if (probe.ok && Array.isArray(probe.data)) {
      signals.push('/wp-json/wc/store/v1/products is open');
      confidence = Math.max(confidence, 0.95);
    }

    return { platform: 'woocommerce', confidence: Math.min(confidence, 1), signals };
  },

  async *fetchProducts(ctx: AdapterContext, options?: FetchOptions): AsyncIterable<NormalizedProduct> {
    const root = rootOf(ctx.url);
    const max = options?.maxProducts ?? Infinity;
    let yielded = 0;
    let page = 1;

    while (yielded < max) {
      const r = await fetchJson<WcStoreProduct[]>(
        `${root}/wp-json/wc/store/v1/products?per_page=${PAGE_SIZE}&page=${page}`
      );
      if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) break;

      for (const p of r.data) {
        if (yielded >= max) return;
        const normalized = normalize(p);
        yielded++;
        options?.onProgress?.({ fetched: yielded, total: null, current: normalized.title });
        yield normalized;
      }

      if (r.data.length < PAGE_SIZE) break;
      page++;
    }
  }
};

function toMajor(minor: string, minorUnit: number): number {
  const n = parseInt(minor, 10);
  if (!Number.isFinite(n)) return 0;
  return n / Math.pow(10, minorUnit);
}

function parseSrcsetMaxWidth(srcset: string | undefined): number | null {
  if (!srcset) return null;
  let max = 0;
  for (const m of srcset.matchAll(/\s(\d+)w(?:,|$)/g)) {
    const w = parseInt(m[1], 10);
    if (w > max) max = w;
  }
  return max > 0 ? max : null;
}

function normalize(p: WcStoreProduct): NormalizedProduct {
  const minorUnit = p.prices?.currency_minor_unit ?? 2;
  const priceMin = toMajor(p.prices?.price ?? '0', minorUnit);
  const regularPrice = toMajor(p.prices?.regular_price ?? '0', minorUnit);
  const priceMax = Math.max(priceMin, regularPrice);

  const images: ProductImage[] = (p.images ?? []).map((img, idx) => ({
    src: img.src,
    alt: img.alt || null,
    width: parseSrcsetMaxWidth(img.srcset),
    height: null,
    position: idx
  }));

  const variants: ProductVariant[] = (p.variations ?? []).map((v) => ({
    id: String(v.id),
    sourceVariantId: String(v.id),
    title: v.attributes?.map((a) => `${a.name}: ${a.value}`).join(', ') || null,
    sku: null,
    price: priceMin,
    available: p.is_in_stock,
    options: Object.fromEntries((v.attributes ?? []).map((a) => [a.name, a.value]))
  }));

  return {
    source: 'woocommerce',
    sourceId: String(p.id),
    sourceUrl: p.permalink || null,
    handle: p.slug,
    title: decodeHtmlEntities(p.name ?? ''),
    descriptionHtml: p.description || p.short_description || '',
    images,
    tags: normalizeTags((p.tags ?? []).map((t) => t.name)),
    variants,
    vendor: p.brands?.[0]?.name ?? null,
    productType: p.categories?.[0]?.name ?? null,
    priceMin: priceMin > 0 ? priceMin : null,
    priceMax: priceMax > 0 ? priceMax : null,
    currency: p.prices?.currency_code || null,
    sku: p.sku || null,
    sourceUpdatedAt: null
  };
}
