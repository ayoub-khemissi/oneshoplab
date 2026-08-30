import { describe, expect, it } from 'vitest';
import { mapAdminProduct, productGid, sourceIdFromGid } from '@/features/shopify-connector';
import { adminProductFixture, singleVariantFixture } from './shopify-fixtures';

const ctx = { shopDomain: 'atelier.myshopify.com', currency: 'EUR' };

describe('mapAdminProduct (Admin GraphQL 2025-07 → NormalizedProduct)', () => {
  it('maps ids, variants, media images, tags and prices like the storefront adapter', () => {
    const p = mapAdminProduct(adminProductFixture, ctx);
    expect(p.source).toBe('shopify');
    expect(p.sourceId).toBe('8123456789012');
    expect(p.handle).toBe('linen-shirt');
    expect(p.sourceUrl).toBe('https://atelier.example/products/linen-shirt');
    expect(p.title).toBe('Linen shirt');
    expect(p.descriptionHtml).toContain('<strong>linen</strong>');
    expect(p.tags).toEqual(['summer', 'linen']);
    expect(p.vendor).toBe('Atelier');
    expect(p.productType).toBe('Shirts');
    expect(p.currency).toBe('EUR');
    expect(p.sourceUpdatedAt?.toISOString()).toBe('2026-08-29T10:15:00.000Z');

    expect(p.variants).toEqual([
      {
        id: '45000000000001',
        sourceVariantId: '45000000000001',
        title: 'S / White',
        sku: 'LS-S-W',
        price: 49.9,
        available: true,
        options: { Size: 'S', Color: 'White' }
      },
      {
        id: '45000000000002',
        sourceVariantId: '45000000000002',
        title: 'M / White',
        sku: null,
        price: 54,
        available: false,
        options: { Size: 'M', Color: 'White' }
      }
    ]);
    expect(p.priceMin).toBe(49.9);
    expect(p.priceMax).toBe(54);
    expect(p.sku).toBe('LS-S-W');

    expect(p.images).toEqual([
      {
        src: 'https://cdn.shopify.com/s/files/1/0001/front.jpg',
        alt: 'Front view',
        width: 1200,
        height: 1600,
        position: 0
      },
      {
        src: 'https://cdn.shopify.com/s/files/1/0001/back.jpg',
        alt: null,
        width: null,
        height: null,
        position: 1
      }
    ]);
  });

  it('falls back to the myshopify URL, drops "Default Title" and null prices', () => {
    const p = mapAdminProduct(singleVariantFixture(), ctx);
    expect(p.sourceId).toBe('1');
    expect(p.sourceUrl).toBe('https://atelier.myshopify.com/products/plain');
    expect(p.variants[0].title).toBeNull();
    expect(p.priceMin).toBeNull();
    expect(p.images).toEqual([]);
    expect(p.sku).toBeNull();
  });

  it('gid helpers round-trip', () => {
    expect(sourceIdFromGid('gid://shopify/Product/42')).toBe('42');
    expect(sourceIdFromGid('42')).toBe('42');
    expect(productGid('42')).toBe('gid://shopify/Product/42');
    expect(productGid('gid://shopify/Product/42')).toBe('gid://shopify/Product/42');
  });
});
