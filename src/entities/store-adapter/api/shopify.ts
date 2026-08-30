import type {
  AdapterContext,
  FetchOptions,
  NormalizedProduct,
  PlatformAdapter,
  PlatformDetection,
  ProductImage,
  ProductVariant
} from '../model/types';
import { fetchJson, normalizeTags, rootOf } from '../lib/fetch-utils';

const PAGE_SIZE = 250;

interface ShopifyApiImage {
  id: number;
  src: string;
  alt: string | null;
  width: number;
  height: number;
  position: number;
}

interface ShopifyApiVariant {
  id: number;
  title: string;
  price: string;
  sku: string;
  available: boolean;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}

interface ShopifyApiOption {
  name: string;
  values: string[];
}

interface ShopifyApiProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  tags: string[] | string;
  images: ShopifyApiImage[];
  variants: ShopifyApiVariant[];
  options?: ShopifyApiOption[];
}

interface ShopifyCart {
  currency: string;
}

export const shopifyAdapter: PlatformAdapter = {
  name: 'shopify',

  async detect(ctx: AdapterContext): Promise<PlatformDetection> {
    const signals: string[] = [];
    let confidence = 0;

    if (ctx.homeHtml) {
      if (/cdn\.shopify\.com/.test(ctx.homeHtml)) {
        signals.push('cdn.shopify.com in home');
        confidence += 0.3;
      }
      if (/Shopify\.theme\b/i.test(ctx.homeHtml)) {
        signals.push('Shopify.theme global');
        confidence += 0.3;
      }
      if (/Shopify-Section/.test(ctx.homeHtml)) {
        signals.push('Shopify-Section markup');
        confidence += 0.2;
      }
      if (/shopifycloud\.com/.test(ctx.homeHtml)) {
        signals.push('shopifycloud.com');
        confidence += 0.2;
      }
    }

    // Definitive: GET /products.json returns { products: [...] }
    const root = rootOf(ctx.url);
    const probe = await fetchJson<{ products: unknown }>(`${root}/products.json?limit=1`);
    if (probe.ok && Array.isArray((probe.data as { products?: unknown })?.products)) {
      signals.push('/products.json returns Shopify catalog JSON');
      confidence = Math.max(confidence, 0.95);
    }

    return { platform: 'shopify', confidence: Math.min(confidence, 1), signals };
  },

  async *fetchProducts(
    ctx: AdapterContext,
    options?: FetchOptions
  ): AsyncIterable<NormalizedProduct> {
    const root = rootOf(ctx.url);
    const max = options?.maxProducts ?? Infinity;

    // Currency is on /cart.js, not /products.json — fetch once.
    const cart = await fetchJson<ShopifyCart>(`${root}/cart.js`);
    const currency = cart.ok ? (cart.data?.currency ?? null) : null;

    let yielded = 0;
    let page = 1;
    while (yielded < max) {
      const r = await fetchJson<{ products: ShopifyApiProduct[] }>(
        `${root}/products.json?limit=${PAGE_SIZE}&page=${page}`
      );
      const products = r.data?.products;
      if (!r.ok || !products?.length) break;

      for (const p of products) {
        if (yielded >= max) return;
        const normalized = normalize(p, root, currency);
        yielded++;
        options?.onProgress?.({ fetched: yielded, total: null, current: normalized.title });
        yield normalized;
      }

      if (products.length < PAGE_SIZE) break;
      page++;
    }
  }
};

function normalize(p: ShopifyApiProduct, root: string, currency: string | null): NormalizedProduct {
  const variants: ProductVariant[] = (p.variants ?? []).map((v) => ({
    id: String(v.id),
    sourceVariantId: String(v.id),
    title: v.title || null,
    sku: v.sku || null,
    price: parseFloat(v.price) || 0,
    available: !!v.available,
    options: collectOptions(v, p.options)
  }));

  const prices = variants.map((v) => v.price).filter((n) => Number.isFinite(n) && n > 0);

  const images: ProductImage[] = (p.images ?? []).map((img, idx) => ({
    src: img.src,
    alt: img.alt ?? null,
    width: img.width ?? null,
    height: img.height ?? null,
    position: img.position ?? idx
  }));

  return {
    source: 'shopify',
    sourceId: String(p.id),
    sourceUrl: `${root}/products/${p.handle}`,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.body_html ?? '',
    images,
    tags: normalizeTags(p.tags),
    variants,
    vendor: p.vendor || null,
    productType: p.product_type || null,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    currency,
    sku: variants.find((v) => v.sku)?.sku ?? null,
    sourceUpdatedAt: p.updated_at ? new Date(p.updated_at) : null
  };
}

function collectOptions(
  v: ShopifyApiVariant,
  options: ShopifyApiOption[] | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  const names = (options ?? []).map((o) => o.name);
  if (v.option1 && names[0]) out[names[0]] = v.option1;
  if (v.option2 && names[1]) out[names[1]] = v.option2;
  if (v.option3 && names[2]) out[names[2]] = v.option3;
  return out;
}
