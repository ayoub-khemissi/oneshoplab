import { createWixClient, wixTokenRequest } from '@/features/wix-connector/api/client';
import { htmlToRichContent } from '@/features/wix-connector/lib/rich-content';
import { fromV3Product } from '@/features/wix-connector/lib/v3-product';
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

describe('htmlToRichContent — what Catalog V3 accepts instead of HTML', () => {
  const texts = (nodes: ReturnType<typeof htmlToRichContent>['nodes']): string[] =>
    nodes.flatMap((n) => (n.textData ? [n.textData.text] : texts(n.nodes)));

  it('turns paragraphs, headings and lists into typed nodes with ids', () => {
    const rc = htmlToRichContent(
      '<h2>Linen cushion</h2><p>Soft <strong>washed</strong> linen.</p><ul><li>45×45 cm</li><li>Ochre</li></ul>'
    );
    expect(rc.nodes.map((n) => n.type)).toEqual(['HEADING', 'PARAGRAPH', 'BULLETED_LIST']);
    expect(rc.nodes[0].headingData).toEqual({ level: 2 });
    expect(rc.nodes[2].nodes.map((n) => n.type)).toEqual(['LIST_ITEM', 'LIST_ITEM']);
    // Ricos wraps list item text in a paragraph.
    expect(rc.nodes[2].nodes[0].nodes[0].type).toBe('PARAGRAPH');
    for (const n of rc.nodes) expect(n.id).toMatch(/^[0-9a-f]{8}$/);
    expect(texts(rc.nodes)).toEqual([
      'Linen cushion',
      'Soft ',
      'washed',
      ' linen.',
      '45×45 cm',
      'Ochre'
    ]);
  });

  it('carries bold, italic, underline and links as decorations, nested included', () => {
    const rc = htmlToRichContent(
      '<p><strong><em>both</em></strong> <u>u</u> <a href="https://x.test/p">link</a> <a href="javascript:alert(1)">no</a></p>'
    );
    const t = rc.nodes[0].nodes.filter((n) => n.type === 'TEXT');
    expect(t[0].textData!.decorations.map((d) => d.type)).toEqual(['BOLD', 'ITALIC']);
    expect(t[0].textData!.decorations[0]).toMatchObject({ fontWeightValue: 700 });
    expect(t.find((n) => n.textData!.text === 'u')!.textData!.decorations[0].type).toBe(
      'UNDERLINE'
    );
    const link = t.find((n) => n.textData!.text === 'link')!;
    expect(link.textData!.decorations[0]).toEqual({
      type: 'LINK',
      linkData: { link: { url: 'https://x.test/p', target: 'BLANK' } }
    });
    // A non-http href is dropped, the text kept.
    const bad = t.find((n) => n.textData!.text === 'no')!;
    expect(bad.textData!.decorations).toEqual([]);
  });

  it('keeps text from tags it does not know, decodes entities, and survives bare text', () => {
    const rc = htmlToRichContent('Plain &amp; <span style="x">simple</span> line');
    expect(rc.nodes).toHaveLength(1);
    expect(rc.nodes[0].type).toBe('PARAGRAPH');
    expect(texts(rc.nodes).join('')).toBe('Plain & simple line');
  });

  it('gives an empty description an empty document, not a crash', () => {
    expect(htmlToRichContent('')).toEqual({ nodes: [] });
    expect(htmlToRichContent('   ')).toEqual({ nodes: [] });
  });
});

describe('fromV3Product — the V3 catalogue folded into the shape the connector maps', () => {
  const v3 = {
    id: 'p3',
    revision: '7',
    name: 'Ochre cushion',
    slug: 'ochre-cushion',
    plainDescription: '<p>Linen.</p>',
    updatedDate: '2026-09-07T10:00:00Z',
    currency: 'EUR',
    url: { url: 'https://shop.example/product-page/ochre-cushion' },
    ribbon: { id: 'r1', name: 'New' },
    additionalRibbons: [{ id: 'r2', name: 'Handmade' }],
    brand: { name: 'Maison' },
    actualPriceRange: { minValue: { amount: '39.00' }, maxValue: { amount: '45.00' } },
    media: {
      itemsInfo: {
        items: [
          {
            id: 'm1',
            altText: 'Front',
            image: { url: 'https://static.wixstatic.com/m1.jpg', width: 800, height: 600 }
          },
          { url: 'https://cdn.test/external.jpg' }
        ]
      }
    },
    categories: ['c1'],
    breadcrumbsInfo: {
      items: [
        { id: 'root', name: 'Home' },
        { id: 'c1', name: 'Cushions' }
      ]
    }
  };

  it('maps prices, media, ribbons, category and url', () => {
    const p = fromV3Product(v3);
    expect(p).toMatchObject({
      id: 'p3',
      revision: '7',
      name: 'Ochre cushion',
      description: '<p>Linen.</p>',
      ribbon: 'New',
      additionalRibbons: ['Handmade'],
      brand: 'Maison',
      priceData: { currency: 'EUR', price: 39 },
      priceRange: { minValue: 39, maxValue: 45 },
      pageUrl: 'https://shop.example/product-page/ochre-cushion',
      categoryName: 'Cushions'
    });
    expect(p.media!.items).toEqual([
      {
        id: 'm1',
        title: 'Front',
        mediaType: 'image',
        image: { url: 'https://static.wixstatic.com/m1.jpg', width: 800, height: 600 }
      },
      {
        id: undefined,
        title: undefined,
        mediaType: 'image',
        image: { url: 'https://cdn.test/external.jpg', width: undefined, height: undefined }
      }
    ]);
  });

  it('then normalises like any Wix product: both ribbons become tags, the category the type', () => {
    const n = mapWixProduct(fromV3Product(v3), { collections: new Map() });
    expect(n.tags).toEqual(['New', 'Handmade']);
    expect(n.productType).toBe('Cushions');
    expect(n.sourceUrl).toBe('https://shop.example/product-page/ochre-cushion');
    expect(n.priceMin).toBe(39);
    expect(n.currency).toBe('EUR');
    expect(n.images[0]).toMatchObject({
      src: 'https://static.wixstatic.com/m1.jpg',
      alt: 'Front',
      sourceImageId: 'm1'
    });
  });
});

describe('createWixClient on a Catalog V3 site', () => {
  type Call = { method: string; path: string; body: Record<string, unknown> | null };
  function stub(routes: Record<string, (call: Call) => unknown>) {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      const call: Call = {
        method: init?.method ?? 'GET',
        path: u.pathname + (u.search ? '?' + u.searchParams.toString() : ''),
        body: init?.body ? JSON.parse(String(init.body)) : null
      };
      calls.push(call);
      if (u.pathname === '/oauth2/token') return Response.json({ access_token: 'tok' });
      const key = `${call.method} ${u.pathname}`;
      const handler = routes[key];
      if (!handler) return new Response('{}', { status: 404 });
      const out = handler(call);
      return out instanceof Response ? out : Response.json(out);
    }) as typeof fetch;
    return { calls, fetchImpl };
  }
  const opts = { appId: 'app', appSecret: 's', instanceId: 'i' };

  it('detects V3 once and queries V3 with the fields the mapper needs', async () => {
    const { calls, fetchImpl } = stub({
      'GET /stores/v3/provision/version': () => ({ catalogVersion: 'V3_CATALOG' }),
      'POST /stores/v3/products/query': () => ({
        products: [{ id: 'a', name: 'A' }],
        pagingMetadata: { total: 1, hasNext: false, cursors: {} }
      })
    });
    const client = createWixClient({ ...opts, fetchImpl });
    const page = await client.productsPage(0);
    expect(page.total).toBe(1);
    expect(page.products[0]).toMatchObject({ id: 'a', name: 'A' });
    const q = calls.find((c) => c.path.startsWith('/stores/v3/products/query'))!;
    expect(q.body).toMatchObject({
      fields: ['PLAIN_DESCRIPTION', 'MEDIA_ITEMS_INFO', 'URL', 'CURRENCY', 'BREADCRUMBS_INFO'],
      query: { cursorPaging: { limit: 100 } }
    });
    expect(calls.filter((c) => c.path.startsWith('/stores/v1/'))).toHaveLength(0);
    expect(await client.catalogVersion()).toBe('v3');
  });

  it('pages by cursor even though the pull asks by offset', async () => {
    let n = 0;
    const { calls, fetchImpl } = stub({
      'GET /stores/v3/provision/version': () => ({ catalogVersion: 'V3_CATALOG' }),
      'POST /stores/v3/products/query': (c) => {
        n += 1;
        return n === 1
          ? {
              products: [{ id: 'a' }],
              pagingMetadata: { total: 2, hasNext: true, cursors: { next: 'CUR' } }
            }
          : { products: [{ id: 'b' }], pagingMetadata: { total: 2, hasNext: false, cursors: {} } };
      }
    });
    const client = createWixClient({ ...opts, fetchImpl });
    await client.productsPage(0);
    const second = await client.productsPage(100);
    expect(second.products[0].id).toBe('b');
    const q2 = calls.filter((c) => c.path.startsWith('/stores/v3/products/query'))[1];
    expect(q2.body).toMatchObject({ query: { cursorPaging: { limit: 100, cursor: 'CUR' } } });
  });

  it('updates with the current revision, rich-content description and a ribbon by name', async () => {
    const { calls, fetchImpl } = stub({
      'GET /stores/v3/products/p1': () => ({ product: { id: 'p1', revision: '3' } }),
      'PATCH /stores/v3/products/p1': () => ({ product: { id: 'p1', revision: '4' } })
    });
    const client = createWixClient({ ...opts, fetchImpl, catalogVersion: 'v3' });
    await client.productUpdate({
      id: 'p1',
      name: 'New name',
      description: '<p>Hi <b>there</b></p>',
      ribbon: 'Sale'
    });
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({
      product: { id: 'p1', revision: '3', name: 'New name', ribbon: { name: 'Sale' } }
    });
    const desc = (patch.body as { product: { description: { nodes: Array<{ type: string }> } } })
      .product.description;
    expect(desc.nodes[0].type).toBe('PARAGRAPH');
    expect(calls.some((c) => c.path.startsWith('/stores/v1/'))).toBe(false);
  });

  it('adds and removes media by rewriting the whole array — existing by id, new by url', async () => {
    const { calls, fetchImpl } = stub({
      'GET /stores/v3/products/p1': () => ({
        product: {
          id: 'p1',
          revision: '9',
          media: { itemsInfo: { items: [{ id: 'm1' }, { id: 'm2' }] } }
        }
      }),
      'PATCH /stores/v3/products/p1': () => ({})
    });
    const client = createWixClient({ ...opts, fetchImpl, catalogVersion: 'v3' });
    await client.productAddMedia('p1', ['https://cdn.test/new.jpg']);
    await client.productRemoveMedia('p1', ['m1']);
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches[0].body).toMatchObject({
      product: {
        revision: '9',
        media: {
          itemsInfo: { items: [{ id: 'm1' }, { id: 'm2' }, { url: 'https://cdn.test/new.jpg' }] }
        }
      }
    });
    expect(patches[1].body).toMatchObject({
      product: { media: { itemsInfo: { items: [{ id: 'm2' }] } } }
    });
  });

  it('when the version endpoint is refused, the first V1 428 settles it on V3', async () => {
    // The 428 that started all this — verbatim shape of what Wix sent.
    const { calls, fetchImpl } = stub({
      'GET /stores/v3/provision/version': () =>
        new Response('{"message":"no scope"}', { status: 428 }),
      'POST /stores/v1/products/query': () =>
        new Response(
          JSON.stringify({
            message: 'Endpoint belongs to CATALOG_V1, but your site is using CATALOG_V3.'
          }),
          { status: 428 }
        ),
      'POST /stores/v3/products/query': () => ({
        products: [],
        pagingMetadata: { total: 0, hasNext: false }
      })
    });
    const client = createWixClient({ ...opts, fetchImpl });
    expect(await client.productsPage(0)).toEqual({ products: [], total: 0 });
    expect(calls.map((c) => c.path.split('?')[0])).toEqual([
      '/oauth2/token',
      '/stores/v3/provision/version',
      '/stores/v1/products/query',
      '/stores/v3/products/query'
    ]);
    expect(await client.catalogVersion()).toBe('v3');
    // And V1 stays V1 when the site says so.
    const v1 = createWixClient({
      ...opts,
      fetchImpl: stub({
        'GET /stores/v3/provision/version': () => ({ catalogVersion: 'V1_CATALOG' })
      }).fetchImpl
    });
    expect(await v1.catalogVersion()).toBe('v1');
  });
});
