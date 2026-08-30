import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mapWixProduct, parseWixWebhookClaims, verifyWixJwt } from '@/features/wix-connector';
import { WIX_PUBLIC_KEY_PEM, wixProductFixture, wixWebhookJwt } from './wix-fixtures';

describe('mapWixProduct', () => {
  it('maps a Wix Stores product to NormalizedProduct', () => {
    const p = mapWixProduct(wixProductFixture, { collections: new Map([['col-1', 'Shirts']]) });
    expect(p).toMatchObject({
      source: 'wix',
      sourceId: wixProductFixture.id,
      sourceUrl: 'https://atelier.wixsite.com/shop/product-page/linen-shirt',
      handle: 'linen-shirt',
      title: 'Linen shirt',
      descriptionHtml: '<p>Breathable <strong>linen</strong> shirt.</p>',
      tags: ['New'],
      vendor: 'Atelier',
      productType: 'Shirts',
      priceMin: 49.9,
      priceMax: 54.9,
      currency: 'EUR',
      sku: 'LS-001'
    });
    expect(p.images).toEqual([
      {
        src: 'https://static.wixstatic.com/media/1.jpg',
        alt: 'Linen shirt front',
        width: 1200,
        height: 1600,
        position: 0
      }
    ]);
    expect(p.variants.map((v) => [v.title, v.sku, v.price, v.available])).toEqual([
      ['S / White', 'LS-S-W', 49.9, true],
      ['M / White', 'LS-M-W', 54.9, false]
    ]);
    expect(p.sourceUpdatedAt?.toISOString()).toBe('2026-08-29T10:15:00.000Z');
  });
  it('tolerates a bare product (no ribbon, media, variants, collections)', () => {
    const p = mapWixProduct({ id: 'x', name: 'Bare' }, { collections: new Map() });
    expect(p).toMatchObject({
      tags: [],
      images: [],
      variants: [],
      productType: null,
      priceMin: null,
      sku: null
    });
  });
});

describe('Wix webhook JWT', () => {
  const event = { instanceId: 'inst-1', eventType: 'ProductChanged', productId: 'prod-9' };
  it('verifies RS256 with the app public key and parses the double-encoded envelope', () => {
    const claims = verifyWixJwt(wixWebhookJwt(event), WIX_PUBLIC_KEY_PEM);
    expect(claims).not.toBeNull();
    expect(parseWixWebhookClaims(claims!)).toEqual({
      instanceId: 'inst-1',
      eventType: 'ProductChanged',
      kind: 'updated',
      productId: 'prod-9'
    });
  });
  it('rejects a foreign key, a tampered payload and an expired token', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      verifyWixJwt(wixWebhookJwt(event, { key: other.privateKey }), WIX_PUBLIC_KEY_PEM)
    ).toBeNull();
    const [h, p, s] = wixWebhookJwt(event).split('.');
    const tampered = Buffer.from(JSON.stringify({ data: '{}', exp: 9e9 })).toString('base64url');
    expect(verifyWixJwt(`${h}.${tampered}.${s}`, WIX_PUBLIC_KEY_PEM)).toBeNull();
    expect(verifyWixJwt(`${h}.${p}`, WIX_PUBLIC_KEY_PEM)).toBeNull();
    expect(verifyWixJwt(wixWebhookJwt(event, { exp: 1 }), WIX_PUBLIC_KEY_PEM)).toBeNull();
  });
  it('classifies created / deleted / app removed and REST-style envelopes', () => {
    const kinds = (eventType: string) =>
      parseWixWebhookClaims(
        verifyWixJwt(wixWebhookJwt({ ...event, eventType }), WIX_PUBLIC_KEY_PEM)!
      )?.kind;
    expect(kinds('ProductCreated')).toBe('created');
    expect(kinds('ProductDeleted')).toBe('deleted');
    expect(kinds('AppRemoved')).toBe('app_removed');
    const rest = parseWixWebhookClaims({
      data: JSON.stringify({
        instanceId: 'inst-2',
        entityFqdn: 'wix.stores.v1.product',
        slug: 'deleted',
        entityId: 'e-1'
      })
    });
    expect(rest).toEqual({
      instanceId: 'inst-2',
      eventType: 'wix.stores.v1.product_deleted',
      kind: 'deleted',
      productId: 'e-1'
    });
    expect(parseWixWebhookClaims({ data: '{}' })).toBeNull();
  });
});
