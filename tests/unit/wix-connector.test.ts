import { wixTokenRequest } from '@/features/wix-connector/api/client';
import { signInstance, verifySignedInstance } from '@/features/wix-connector/lib/signed-instance';
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
        position: 0,
        sourceImageId: 'm1'
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

describe('signedInstance (external install flow)', () => {
  const SECRET = 'app-secret-under-test';
  const payload = { instanceId: 'inst-42', uid: 'u1', siteOwnerId: 'u1', permissions: 'OWNER' };

  it('accepts what Wix signed with the app secret and reads the instance out', () => {
    const parsed = verifySignedInstance(signInstance(payload, SECRET), SECRET);
    expect(parsed).toMatchObject({ instanceId: 'inst-42', uid: 'u1', permissions: 'OWNER' });
  });

  it('refuses a payload signed with another secret', () => {
    expect(verifySignedInstance(signInstance(payload, 'not-our-secret'), SECRET)).toBeNull();
  });

  it('refuses a tampered payload — the instance id is exactly what an attacker would change', () => {
    const [sig, data] = signInstance(payload, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, instanceId: 'inst-99' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifySignedInstance(`${sig}.${forged}`, SECRET)).toBeNull();
    expect(data).not.toBe(forged);
  });

  it('refuses garbage without throwing', () => {
    for (const bad of [
      null,
      '',
      'nodot',
      '.x',
      'x.',
      'a.b',
      signInstance({ uid: 'no-instance' }, SECRET)
    ]) {
      expect(verifySignedInstance(bad, SECRET)).toBeNull();
    }
  });
});

describe('wixTokenRequest (client credentials)', () => {
  it('mints an access token from app id, app secret and instance id', async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 14400 });
    }) as typeof fetch;
    const t = await wixTokenRequest(
      { appId: 'app', appSecret: 'secret', instanceId: 'inst-1' },
      fetchImpl
    );
    expect(t).toEqual({ accessToken: 'tok-1' });
    expect(seen[0].url).toBe('https://www.wixapis.com/oauth2/token');
    expect(seen[0].body).toEqual({
      grant_type: 'client_credentials',
      client_id: 'app',
      client_secret: 'secret',
      instance_id: 'inst-1'
    });
  });

  it('a refused instance — the app was removed from the site — is token_invalid', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401 })) as typeof fetch;
    await expect(
      wixTokenRequest({ appId: 'app', appSecret: 'secret', instanceId: 'gone' }, fetchImpl)
    ).rejects.toMatchObject({ code: 'token_invalid' });
  });
});
