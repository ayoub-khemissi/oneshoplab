/**
 * `productRowToNormalized` is the inverse of what `syncProjectProducts`
 * persists: anything that already owns the catalog (a connected store, a
 * from-scratch project) is scored through it instead of being re-scraped.
 * The field that must survive is `sourceImageId` — losing it degrades every
 * image op to replace-all (docs/api/IMAGE-OPS.md §1).
 */
import { describe, expect, it } from 'vitest';
import { productRowToNormalized, type ProductRow } from '@/entities/product';

const BASE: ProductRow = {
  id: 'row-1',
  projectId: 'proj-1',
  source: 'woocommerce',
  sourceId: '42',
  sourceUrl: 'https://shop.example/product/42',
  handle: 'nice-mug',
  title: 'Nice mug',
  descriptionHtml: '<p>Hello</p><ul><li>a</li></ul>',
  images: [
    {
      src: 'https://cdn.example/1.jpg',
      alt: 'front',
      width: 1200,
      height: 900,
      position: 0,
      sourceImageId: 'wp-991'
    },
    { src: 'https://cdn.example/2.jpg', alt: null, width: null, height: null }
  ],
  tags: ['mug', 'kitchen'],
  variants: [
    {
      id: 'v1',
      title: 'Large',
      price: 15.5,
      sku: 'MUG-L',
      available: true,
      options: { size: 'L' }
    },
    { id: 'v2', title: null, price: 19, sku: null, available: false, options: {} }
  ],
  vendor: 'Acme',
  productType: 'Mugs',
  priceMin: '15.50',
  priceMax: '19.00',
  currency: 'EUR',
  sku: 'MUG',
  sourceUpdatedAt: new Date('2026-08-01T10:00:00Z'),
  customInstructions: 'keep it short',
  status: 'active',
  lastSeenAt: new Date('2026-08-30T10:00:00Z'),
  archivedAt: null,
  manuallyArchived: false,
  createdAt: new Date('2026-07-01T10:00:00Z'),
  updatedAt: new Date('2026-08-30T10:00:00Z')
};

describe('productRowToNormalized', () => {
  it('maps a stored row back to the shape the adapters emit', () => {
    expect(productRowToNormalized(BASE)).toEqual({
      source: 'woocommerce',
      sourceId: '42',
      sourceUrl: 'https://shop.example/product/42',
      handle: 'nice-mug',
      title: 'Nice mug',
      descriptionHtml: '<p>Hello</p><ul><li>a</li></ul>',
      images: [
        {
          src: 'https://cdn.example/1.jpg',
          alt: 'front',
          width: 1200,
          height: 900,
          position: 0,
          sourceImageId: 'wp-991'
        },
        {
          src: 'https://cdn.example/2.jpg',
          alt: null,
          width: null,
          height: null,
          // No stored position: fall back to catalog order.
          position: 1,
          sourceImageId: null
        }
      ],
      tags: ['mug', 'kitchen'],
      variants: [
        {
          id: 'v1',
          sourceVariantId: null,
          title: 'Large',
          sku: 'MUG-L',
          price: 15.5,
          available: true,
          options: { size: 'L' }
        },
        {
          id: 'v2',
          sourceVariantId: null,
          title: null,
          sku: null,
          price: 19,
          available: false,
          options: {}
        }
      ],
      vendor: 'Acme',
      productType: 'Mugs',
      priceMin: 15.5,
      priceMax: 19,
      currency: 'EUR',
      sku: 'MUG',
      sourceUpdatedAt: new Date('2026-08-01T10:00:00Z')
    });
  });

  it('keeps the store-side image id — the thing a scrape cannot know', () => {
    const images = productRowToNormalized(BASE).images;
    expect(images.map((i) => i.sourceImageId)).toEqual(['wp-991', null]);
  });

  it('turns the DECIMAL price columns back into numbers', () => {
    const p = productRowToNormalized(BASE);
    expect(typeof p.priceMin).toBe('number');
    expect(typeof p.priceMax).toBe('number');
    expect(typeof p.variants[0].price).toBe('number');
    expect(productRowToNormalized({ ...BASE, priceMin: null, priceMax: null })).toMatchObject({
      priceMin: null,
      priceMax: null
    });
  });

  it('tolerates the nullable columns', () => {
    const p = productRowToNormalized({
      ...BASE,
      descriptionHtml: null,
      images: null,
      tags: null,
      variants: null,
      vendor: null,
      productType: null,
      currency: null,
      sku: null,
      sourceUpdatedAt: null
    });
    expect(p).toMatchObject({
      descriptionHtml: '',
      images: [],
      tags: [],
      variants: [],
      sourceUpdatedAt: null
    });
  });

  it('applies the manual-project fallbacks (row id as sourceId, updatedAt as date)', () => {
    const fallback = new Date('2026-08-29T00:00:00Z');
    const p = productRowToNormalized(
      { ...BASE, sourceId: null, sourceUpdatedAt: null },
      { source: 'manual', sourceIdFallback: BASE.id, sourceUpdatedAtFallback: fallback }
    );
    expect(p).toMatchObject({ source: 'manual', sourceId: 'row-1', sourceUpdatedAt: fallback });
    // An explicit column always wins over the fallback.
    expect(productRowToNormalized(BASE, { sourceIdFallback: 'row-1' }).sourceId).toBe('42');
  });
});
