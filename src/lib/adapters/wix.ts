import type {
  AdapterContext,
  FetchOptions,
  NormalizedProduct,
  PlatformAdapter,
  PlatformDetection,
  ProductImage
} from './types';
import { decodeHtmlEntities, fetchText, rootOf } from './fetch-utils';

const CONCURRENCY = 6;

interface WixOffer {
  price?: string | number;
  priceCurrency?: string;
  Availability?: string;
  availability?: string;
}

interface WixImageObject {
  contentUrl?: string;
  width?: string | number;
  height?: string | number;
  name?: string;
}

interface WixProductLd {
  '@type'?: string;
  name?: string;
  description?: string;
  image?: WixImageObject | WixImageObject[] | string | string[];
  Offers?: WixOffer;
  offers?: WixOffer;
  sku?: string;
  brand?: { name?: string };
}

export const wixAdapter: PlatformAdapter = {
  name: 'wix',

  async detect(ctx: AdapterContext): Promise<PlatformDetection> {
    const signals: string[] = [];
    let confidence = 0;

    if (ctx.homeHtml) {
      if (/<meta[^>]+content=["']Wix\.com[^"']*["']/i.test(ctx.homeHtml)) {
        signals.push('Wix.com generator meta');
        confidence += 0.5;
      }
      if (/static\.parastorage\.com/.test(ctx.homeHtml)) {
        signals.push('static.parastorage.com');
        confidence += 0.3;
      }
      if (/wixstatic\.com/.test(ctx.homeHtml)) {
        signals.push('wixstatic.com');
        confidence += 0.2;
      }
    }

    // Many Wix shops render as a JS shell — the initial HTML body
    // doesn't carry the Wix.com / parastorage / wixstatic markers,
    // so the body-only check above misses them. Wix's CDN (Pepyaka)
    // and request-id header are present on every response regardless
    // of render path, so a HEAD-style probe of the root is the most
    // reliable detect for SPA shops.
    if (confidence < 0.7) {
      const root = rootOf(ctx.url);
      const probe = await fetchText(root, { method: 'HEAD' as never });
      const server = (probe.headers?.get('server') ?? '').toLowerCase();
      const hasWixHeaders =
        server.includes('pepyaka') ||
        probe.headers?.has('x-wix-request-id') ||
        probe.headers?.has('x-wix-cache-control');
      if (hasWixHeaders) {
        signals.push(`Wix HTTP headers (server=${server || 'n/a'})`);
        confidence = Math.max(confidence, 0.85);
      }
    }

    // Wix Stores requires the products sitemap to exist — only check
    // it for sites we already think are Wix, and use it to lift
    // confidence above the threshold.
    if (confidence > 0.4) {
      const root = rootOf(ctx.url);
      const probe = await fetchText(`${root}/store-products-sitemap.xml`);
      if (probe.ok && /<urlset/i.test(probe.body)) {
        signals.push('/store-products-sitemap.xml exists');
        confidence = Math.max(confidence, 0.9);
      }
    }

    return { platform: 'wix', confidence: Math.min(confidence, 1), signals };
  },

  async *fetchProducts(
    ctx: AdapterContext,
    options?: FetchOptions
  ): AsyncIterable<NormalizedProduct> {
    const root = rootOf(ctx.url);
    const max = options?.maxProducts ?? Infinity;

    const sitemap = await fetchText(`${root}/store-products-sitemap.xml`);
    if (!sitemap.ok) return;

    const urls = parseSitemapProductUrls(sitemap.body).slice(0, max);
    if (urls.length === 0) return;

    let yielded = 0;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const page = await fetchText(encodeURI(url));
          if (!page.ok) return null;
          return extractFromJsonLd(page.body, url);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          yielded++;
          options?.onProgress?.({ fetched: yielded, total: urls.length, current: r.value.title });
          yield r.value;
        }
      }
    }
  }
};

function parseSitemapProductUrls(xml: string): string[] {
  const urls: string[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    const url = m[1].trim();
    if (url.includes('/product-page/') || url.includes('/shop/p/')) {
      urls.push(url);
    }
  }
  return urls;
}

function extractFromJsonLd(html: string, productUrl: string): NormalizedProduct | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  let productLd: WixProductLd | null = null;
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      if (c && typeof c === 'object' && (c as { '@type'?: string })['@type'] === 'Product') {
        productLd = c as WixProductLd;
        break;
      }
    }
    if (productLd) break;
  }
  if (!productLd) return null;

  const offers = productLd.Offers ?? productLd.offers ?? null;
  const priceRaw = offers?.price;
  const price = priceRaw != null && priceRaw !== '' ? parseFloat(String(priceRaw)) : null;
  const currency = offers?.priceCurrency ?? null;

  const imageInput = productLd.image;
  const imageArr: Array<WixImageObject | string> = Array.isArray(imageInput)
    ? imageInput
    : imageInput
      ? [imageInput]
      : [];

  const images: ProductImage[] = imageArr.map((img, i) => {
    if (typeof img === 'string') {
      return { src: img, alt: null, width: null, height: null, position: i };
    }
    const widthNum = img.width != null ? parseInt(String(img.width), 10) : null;
    const heightNum = img.height != null ? parseInt(String(img.height), 10) : null;
    return {
      src: img.contentUrl ?? '',
      alt: img.name ?? null,
      width: Number.isFinite(widthNum ?? NaN) ? widthNum : null,
      height: Number.isFinite(heightNum ?? NaN) ? heightNum : null,
      position: i
    };
  });

  const slug = (() => {
    try {
      const u = new URL(productUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  })();

  return {
    source: 'wix',
    sourceId: productLd.sku ?? slug,
    sourceUrl: productUrl,
    handle: slug,
    title: decodeHtmlEntities(String(productLd.name ?? '')),
    descriptionHtml: decodeHtmlEntities(String(productLd.description ?? '')),
    images,
    tags: [],
    variants: [],
    vendor: productLd.brand?.name ?? null,
    productType: null,
    priceMin: price,
    priceMax: price,
    currency,
    sku: productLd.sku ?? null,
    sourceUpdatedAt: null
  };
}
