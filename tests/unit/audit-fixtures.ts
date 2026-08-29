/**
 * Hand-built product fixtures for the audit engine tests. `perfectProduct()`
 * satisfies every scoring rule in `src/lib/audit/score.ts` (scores 100, no
 * issues); each test derives a flawed variant from it with `product({...})`.
 */
import type { NormalizedProduct, ProductImage } from '@/lib/adapters/types';

export const PERFECT_TITLE = 'Hand-thrown stoneware coffee mug, 350 ml'; // 40 chars
export const SHORT_TITLE = 'Coffee mug'; // 10 chars

/** ≥600 chars of text with a list → descScore 100, structured. */
export const PERFECT_DESCRIPTION_HTML =
  '<p>' +
  'Thrown on the wheel in our workshop, this stoneware mug holds 350 ml of coffee or tea. '.repeat(
    7
  ) +
  '</p><ul><li>Dishwasher safe</li><li>Microwave safe</li><li>Lead-free glaze</li></ul>';

export function image(overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    src: 'https://cdn.example.com/mug.jpg',
    alt: 'Stoneware mug on a wooden table',
    width: 1200,
    height: 1200,
    position: 0,
    ...overrides
  };
}

export function images(n: number, overrides: Partial<ProductImage> = {}): ProductImage[] {
  return Array.from({ length: n }, (_, i) =>
    image({ src: `https://cdn.example.com/mug-${i}.jpg`, position: i, ...overrides })
  );
}

export function product(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    source: 'shopify',
    sourceId: '1',
    sourceUrl: 'https://shop.example.com/products/mug',
    handle: 'mug',
    title: PERFECT_TITLE,
    descriptionHtml: PERFECT_DESCRIPTION_HTML,
    images: images(4),
    tags: ['mug', 'stoneware', 'coffee', 'handmade', 'kitchen'],
    variants: [
      {
        id: 'v1',
        sourceVariantId: 'v1',
        title: 'Default',
        sku: 'MUG-1',
        price: 24,
        available: true,
        options: {}
      }
    ],
    vendor: 'Atelier',
    productType: 'Mug',
    priceMin: 24,
    priceMax: 24,
    currency: 'EUR',
    sku: 'MUG-1',
    sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  };
}

export const perfectProduct = (): NormalizedProduct => product();

/** Nothing filled in: 0 on every axis. */
export const emptyProduct = (): NormalizedProduct =>
  product({
    sourceId: '0',
    handle: 'empty',
    title: '',
    descriptionHtml: '',
    images: [],
    tags: [],
    variants: [],
    vendor: null,
    productType: null,
    priceMin: null,
    priceMax: null,
    sku: null,
    sourceUpdatedAt: null
  });

/** Plain text of a given length (no HTML structure). */
export function plainText(len: number): string {
  return 'lorem ipsum '.repeat(Math.ceil(len / 12)).slice(0, len);
}
