/**
 * Store adapters turn platform payloads into NormalizedProduct — the input
 * of the audit engine. Fixtures mirror the real API shapes; `fetch` is
 * stubbed per URL, nothing leaves the box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform } from '@/lib/adapters';
import { shopifyAdapter } from '@/lib/adapters/shopify';
import { wixAdapter } from '@/lib/adapters/wix';
import { woocommerceAdapter } from '@/lib/adapters/woocommerce';
import type { NormalizedProduct } from '@/lib/adapters/types';

type Route = (url: string) => Response | null;
let routes: Route[] = [];
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...headers } });
}
const calls: string[] = [];
beforeEach(() => {
  routes = [];
  calls.length = 0;
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    for (const r of routes) {
      const res = r(url);
      if (res) return res;
    }
    return new Response('not found', { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function collect(it: AsyncIterable<NormalizedProduct>): Promise<NormalizedProduct[]> {
  const out: NormalizedProduct[] = [];
  for await (const p of it) out.push(p);
  return out;
}

const shopifyProduct = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Mug ${id}`,
  handle: `mug-${id}`,
  body_html: '<p>Stoneware mug</p>',
  vendor: 'Atelier',
  product_type: 'Mug',
  tags: 'mug, stoneware,  Coffee ',
  updated_at: '2026-05-01T10:00:00Z',
  options: [{ name: 'Color' }, { name: 'Size' }],
  variants: [
    {
      id: id * 10 + 1,
      title: 'Blue / S',
      sku: `M${id}-B`,
      price: '24.00',
      available: true,
      option1: 'Blue',
      option2: 'S'
    },
    {
      id: id * 10 + 2,
      title: 'Red / L',
      sku: '',
      price: '29.50',
      available: false,
      option1: 'Red',
      option2: 'L'
    }
  ],
  images: [
    {
      src: 'https://cdn.shopify.com/a.jpg',
      alt: 'Blue mug',
      width: 1200,
      height: 1200,
      position: 1
    },
    { src: 'https://cdn.shopify.com/b.jpg', alt: null, width: 640, height: 640, position: 2 }
  ],
  ...extra
});

describe('shopify adapter', () => {
  it('normalises products.json: variants, options, price range, tags, images', async () => {
    routes.push((u) => (u.endsWith('/cart.js') ? json({ currency: 'EUR' }) : null));
    routes.push((u) =>
      u.includes('/products.json') ? json({ products: [shopifyProduct(7)] }) : null
    );
    const [p] = await collect(
      shopifyAdapter.fetchProducts({ url: 'https://shop.example.com/collections/all' })
    );
    expect(p).toMatchObject({
      source: 'shopify',
      sourceId: '7',
      handle: 'mug-7',
      sourceUrl: 'https://shop.example.com/products/mug-7',
      title: 'Mug 7',
      descriptionHtml: '<p>Stoneware mug</p>',
      vendor: 'Atelier',
      productType: 'Mug',
      currency: 'EUR',
      priceMin: 24,
      priceMax: 29.5,
      sku: 'M7-B'
    });
    expect(p.tags).toEqual(['mug', 'stoneware', 'Coffee']); // trimmed, case kept
    expect(p.variants[0]).toMatchObject({
      id: '71',
      price: 24,
      available: true,
      options: { Color: 'Blue', Size: 'S' }
    });
    expect(p.variants[1]).toMatchObject({ sku: null, available: false });
    expect(p.images.map((i) => i.alt)).toEqual(['Blue mug', null]);
    expect(p.images[1].width).toBe(640);
    expect(p.sourceUpdatedAt?.toISOString()).toBe('2026-05-01T10:00:00.000Z');
  });

  it('paginates until a short page and honours maxProducts', async () => {
    routes.push((u) => (u.endsWith('/cart.js') ? json({}, 404) : null));
    routes.push((u) => {
      const m = /products\.json\?limit=(\d+)&page=(\d+)/.exec(u);
      if (!m) return null;
      const limit = Number(m[1]);
      const page = Number(m[2]);
      const n = page === 1 ? limit : 3; // page 1 full, page 2 short
      return json({
        products: Array.from({ length: n }, (_, i) => shopifyProduct((page - 1) * limit + i + 1))
      });
    });
    const all = await collect(shopifyAdapter.fetchProducts({ url: 'https://shop.example.com' }));
    expect(all).toHaveLength(253);
    expect(all[0].currency).toBeNull();
    expect(calls.filter((c) => c.includes('products.json'))).toHaveLength(2);

    calls.length = 0;
    const some = await collect(
      shopifyAdapter.fetchProducts({ url: 'https://shop.example.com' }, { maxProducts: 5 })
    );
    expect(some).toHaveLength(5);
    expect(calls.filter((c) => c.includes('products.json'))).toHaveLength(1);
  });

  it('detects Shopify definitively through /products.json, with HTML hints as fallback', async () => {
    routes.push((u) => (u.includes('/products.json') ? json({ products: [] }) : null));
    const d = await shopifyAdapter.detect({
      url: 'https://shop.example.com',
      homeHtml: '<html></html>'
    });
    expect(d.platform).toBe('shopify');
    expect(d.confidence).toBeGreaterThanOrEqual(0.95);

    routes = [];
    const hints = await shopifyAdapter.detect({
      url: 'https://shop.example.com',
      homeHtml:
        '<script src="https://cdn.shopify.com/x.js"></script><script>Shopify.theme = {}</script>'
    });
    expect(hints.confidence).toBeCloseTo(0.6, 5);
    expect(hints.signals).toHaveLength(2);
  });
});

const wcProduct = (id: number) => ({
  id,
  name: 'Caf&eacute; &amp; Th&eacute; box',
  slug: `box-${id}`,
  permalink: `https://wc.example.com/product/box-${id}/`,
  type: 'variable',
  sku: `BOX-${id}`,
  short_description: '<p>Short</p>',
  description: '<p>Long description</p>',
  on_sale: true,
  is_in_stock: true,
  prices: {
    price: '1990',
    regular_price: '2490',
    sale_price: '1990',
    currency_code: 'EUR',
    currency_minor_unit: 2
  },
  images: [
    {
      id: 1,
      src: 'https://wc.example.com/a.jpg',
      thumbnail: '',
      alt: 'Box',
      name: 'a',
      srcset: 'https://wc.example.com/a-300.jpg 300w, https://wc.example.com/a-1024.jpg 1024w'
    },
    { id: 2, src: 'https://wc.example.com/b.jpg', thumbnail: '', alt: '', name: 'b', srcset: '' }
  ],
  categories: [{ id: 1, name: 'Boxes', slug: 'boxes' }],
  tags: [
    { id: 1, name: 'Gift', slug: 'gift' },
    { id: 2, name: 'gift', slug: 'gift-2' }
  ],
  brands: [{ id: 1, name: 'Maison', slug: 'maison' }],
  variations: [{ id: 501, attributes: [{ name: 'Size', value: 'L' }] }]
});

describe('woocommerce adapter (Store API)', () => {
  it('normalises minor-unit prices, entities, srcset widths, brands/categories', async () => {
    // The adapter probes `per_page=1` first, then pages with per_page=100.
    routes.push((u) => (u.includes('/wp-json/wc/store/v1/products') ? json([wcProduct(3)]) : null));
    const [p] = await collect(woocommerceAdapter.fetchProducts({ url: 'https://wc.example.com' }));
    expect(p).toMatchObject({
      source: 'woocommerce',
      sourceId: '3',
      handle: 'box-3',
      title: 'Café & Thé box',
      descriptionHtml: '<p>Long description</p>',
      priceMin: 19.9,
      priceMax: 24.9,
      currency: 'EUR',
      vendor: 'Maison',
      productType: 'Boxes',
      sku: 'BOX-3'
    });
    expect(p.tags).toEqual(['Gift', 'gift']);
    expect(p.images[0]).toMatchObject({ alt: 'Box', width: 1024 });
    expect(p.images[1]).toMatchObject({ alt: null, width: null });
    expect(p.variants[0]).toMatchObject({
      id: '501',
      title: 'Size: L',
      price: 19.9,
      options: { Size: 'L' }
    });
  });

  it('stops on an empty page', async () => {
    routes.push((u) => {
      if (!u.includes('/wp-json/wc/store/v1/products')) return null;
      const m = /per_page=(\d+)&page=(\d+)/.exec(u);
      if (!m) return json([wcProduct(0)]); // probe
      return json(Number(m[2]) === 1 ? [wcProduct(1), wcProduct(2)] : []);
    });
    const all = await collect(woocommerceAdapter.fetchProducts({ url: 'https://wc.example.com' }));
    expect(all.map((p) => p.sourceId)).toEqual(['1', '2']);
  });
});

describe('detectPlatform', () => {
  it('picks the most confident adapter and falls back to unknown below the threshold', async () => {
    routes.push((u) =>
      u === 'https://shop.example.com' ? html('<html>Shopify.theme</html>') : null
    );
    routes.push((u) => (u.includes('/products.json') ? json({ products: [] }) : null));
    const r = await detectPlatform('https://shop.example.com/some/page');
    expect(r.detection.platform).toBe('shopify');
    expect(r.adapter?.name).toBe('shopify');

    routes = [(u) => (u === 'https://plain.example.com' ? html('<html>hello</html>') : null)];
    const u = await detectPlatform('https://plain.example.com');
    expect(u.detection.platform).toBe('unknown');
    expect(u.adapter).toBeNull();
  });
});

describe('wix adapter', () => {
  it('walks the store sitemap and reads Product JSON-LD from each page', async () => {
    const ld = {
      '@type': 'Product',
      name: 'Bougie &amp; Co',
      description: 'Hand-poured',
      sku: 'CANDLE-1',
      brand: { name: 'Wix Brand' },
      image: [
        {
          contentUrl: 'https://static.wixstatic.com/a.jpg',
          name: 'Candle',
          width: '1000',
          height: '1000'
        },
        'https://static.wixstatic.com/b.jpg'
      ],
      offers: { price: '19.90', priceCurrency: 'EUR' }
    };
    routes.push((u) =>
      u.endsWith('/store-products-sitemap.xml')
        ? html(
            `<urlset><url><loc>https://wix.example.com/product-page/candle</loc></url><url><loc>https://wix.example.com/about</loc></url><url><loc>https://wix.example.com/product-page/missing</loc></url></urlset>`
          )
        : null
    );
    routes.push((u) =>
      u === 'https://wix.example.com/product-page/candle'
        ? html(`<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`)
        : null
    );
    const all = await collect(wixAdapter.fetchProducts({ url: 'https://wix.example.com' }));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      source: 'wix',
      sourceId: 'CANDLE-1',
      handle: 'candle',
      title: 'Bougie & Co',
      vendor: 'Wix Brand',
      priceMin: 19.9,
      currency: 'EUR'
    });
    expect(all[0].images).toEqual([
      {
        src: 'https://static.wixstatic.com/a.jpg',
        alt: 'Candle',
        width: 1000,
        height: 1000,
        position: 0
      },
      {
        src: 'https://static.wixstatic.com/b.jpg',
        alt: null,
        width: null,
        height: null,
        position: 1
      }
    ]);
  });

  it('detects Wix from wixstatic markers in the home page', async () => {
    const d = await wixAdapter.detect({
      url: 'https://wix.example.com',
      homeHtml: '<img src="https://static.wixstatic.com/x.png">'
    });
    expect(d.platform).toBe('wix');
    expect(d.signals).toContain('wixstatic.com');
  });
});
