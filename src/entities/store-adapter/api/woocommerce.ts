import type {
  AdapterContext,
  FetchOptions,
  NormalizedProduct,
  PlatformAdapter,
  PlatformDetection,
  ProductImage,
  ProductVariant
} from '../model/types';
import { decodeHtmlEntities, fetchJson, normalizeTags, rootOf } from '../lib/fetch-utils';

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
    } else {
      // Fallback signal: many WooCommerce shops disable Blocks (and
      // thus Store API) but expose the WP REST `product` CPT. If we
      // can list at least one product through that, treat the site
      // as a fetchable WooCommerce shop — fetchProducts has a matching
      // fallback path.
      const wpProbe = await fetchJson<unknown>(`${root}/wp-json/wp/v2/product?per_page=1`);
      if (wpProbe.ok && Array.isArray(wpProbe.data) && wpProbe.data.length > 0) {
        signals.push('/wp-json/wp/v2/product is open (WP REST CPT)');
        confidence = Math.max(confidence, 0.9);
      }
    }

    return { platform: 'woocommerce', confidence: Math.min(confidence, 1), signals };
  },

  async *fetchProducts(
    ctx: AdapterContext,
    options?: FetchOptions
  ): AsyncIterable<NormalizedProduct> {
    const root = rootOf(ctx.url);
    const max = options?.maxProducts ?? Infinity;

    // Strategy 1: WooCommerce Store API (preferred — richest schema,
    // prices, variants, tags inline). Requires the WC Blocks plugin
    // to be installed and the REST API to be open.
    const storeProbe = await fetchJson<WcStoreProduct[]>(
      `${root}/wp-json/wc/store/v1/products?per_page=1`
    );
    if (storeProbe.ok && Array.isArray(storeProbe.data)) {
      yield* fetchViaStoreApi(root, max, options);
      return;
    }

    // Strategy 2: WordPress REST CPT (`/wp-json/wp/v2/product`).
    // Many older WooCommerce shops have Store API disabled or never
    // installed WC Blocks, but their `product` custom post type is
    // still exposed by core WP REST. Schema is leaner — no prices,
    // no variants — but we get title + description + images + tags
    // which is enough for the audit + AI rewrite pipeline.
    const wpProbe = await fetchJson<WpRestProduct[]>(`${root}/wp-json/wp/v2/product?per_page=1`);
    if (wpProbe.ok && Array.isArray(wpProbe.data)) {
      yield* fetchViaWpRest(root, max, options);
      return;
    }

    // Neither endpoint usable — yield nothing. The audit will land
    // with `products_sampled: 0` and the dashboard explains the
    // empty state to the merchant.
  }
};

async function* fetchViaStoreApi(
  root: string,
  max: number,
  options?: FetchOptions
): AsyncIterable<NormalizedProduct> {
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

// ---------------------------------------------------------------------------
// Fallback: WordPress REST API (Custom Post Type)
// ---------------------------------------------------------------------------

interface WpRestRendered {
  rendered: string;
}

interface WpRestTerm {
  id: number;
  name: string;
  slug: string;
  taxonomy: string;
}

interface WpRestMedia {
  id: number;
  source_url: string;
  alt_text: string;
  media_details?: { width?: number; height?: number };
}

interface WpRestProduct {
  id: number;
  slug: string;
  link: string;
  date_gmt: string;
  modified_gmt: string;
  status: string;
  title: WpRestRendered;
  content: WpRestRendered;
  excerpt: WpRestRendered;
  featured_media: number;
  product_cat?: number[];
  product_tag?: number[];
  _embedded?: {
    'wp:featuredmedia'?: WpRestMedia[];
    'wp:term'?: WpRestTerm[][];
  };
}

function* normalizeWpRest(p: WpRestProduct): Generator<NormalizedProduct> {
  // Skip draft/private posts — the merchant doesn't sell those.
  if (p.status && p.status !== 'publish') return;

  // Featured media is the only image WP REST gives us per-product
  // without scraping galleries. Better than nothing — the AI image
  // pipeline edits the source image to produce angles, so one is
  // sufficient.
  const featured = p._embedded?.['wp:featuredmedia']?.[0];
  const images: ProductImage[] = featured?.source_url
    ? [
        {
          src: featured.source_url,
          alt: featured.alt_text || null,
          width: featured.media_details?.width ?? null,
          height: featured.media_details?.height ?? null,
          position: 0
        }
      ]
    : [];

  const terms = p._embedded?.['wp:term'] ?? [];
  const tagTerms: WpRestTerm[] = [];
  const catTerms: WpRestTerm[] = [];
  for (const group of terms) {
    for (const t of group) {
      if (t.taxonomy === 'product_tag') tagTerms.push(t);
      else if (t.taxonomy === 'product_cat') catTerms.push(t);
    }
  }

  yield {
    source: 'woocommerce',
    sourceId: String(p.id),
    sourceUrl: p.link || null,
    handle: p.slug,
    title: decodeHtmlEntities(p.title?.rendered ?? ''),
    descriptionHtml: p.content?.rendered || p.excerpt?.rendered || '',
    images,
    tags: normalizeTags(tagTerms.map((t) => t.name)),
    variants: [],
    vendor: null,
    productType: catTerms[0]?.name ?? null,
    priceMin: null,
    priceMax: null,
    currency: null,
    sku: null,
    sourceUpdatedAt: p.modified_gmt ? new Date(p.modified_gmt + 'Z') : null
  };
}

async function* fetchViaWpRest(
  root: string,
  max: number,
  options?: FetchOptions
): AsyncIterable<NormalizedProduct> {
  let yielded = 0;
  let page = 1;
  while (yielded < max) {
    // `_embed=true` inlines featured media and terms so we don't
    // need a round-trip per product to resolve image / tag URLs.
    const r = await fetchJson<WpRestProduct[]>(
      `${root}/wp-json/wp/v2/product?per_page=${PAGE_SIZE}&page=${page}&_embed=true&status=publish`
    );
    if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) break;
    for (const p of r.data) {
      if (yielded >= max) return;
      for (const normalized of normalizeWpRest(p)) {
        yielded++;
        options?.onProgress?.({ fetched: yielded, total: null, current: normalized.title });
        yield normalized;
      }
    }
    if (r.data.length < PAGE_SIZE) break;
    page++;
  }
}

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
