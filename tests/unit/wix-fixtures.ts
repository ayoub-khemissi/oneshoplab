/** Hand-written after the Wix Stores v1 Product shape (query products, includeVariants). */
import { generateKeyPairSync, sign } from 'node:crypto';
import type { WixProduct } from '@/features/wix-connector';

export const wixProductFixture: WixProduct = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  name: 'Linen shirt',
  slug: 'linen-shirt',
  visible: true,
  productType: 'physical',
  description: '<p>Breathable <strong>linen</strong> shirt.</p>',
  sku: 'LS-001',
  brand: 'Atelier',
  ribbon: ' New ',
  priceData: { currency: 'EUR', price: 49.9 },
  priceRange: { minValue: 49.9, maxValue: 54.9 },
  media: {
    items: [
      {
        id: 'm1',
        title: 'Linen shirt front',
        mediaType: 'image',
        image: { url: 'https://static.wixstatic.com/media/1.jpg', width: 1200, height: 1600 }
      },
      { id: 'v1', mediaType: 'video' }
    ]
  },
  productPageUrl: { base: 'https://atelier.wixsite.com/shop/', path: '/product-page/linen-shirt' },
  collectionIds: ['col-1', 'col-missing'],
  variants: [
    {
      id: 'var-1',
      choices: { Size: 'S', Color: 'White' },
      variant: { priceData: { price: 49.9 }, sku: 'LS-S-W', visible: true },
      stock: { inStock: true }
    },
    {
      id: 'var-2',
      choices: { Size: 'M', Color: 'White' },
      variant: { priceData: { price: 54.9 }, sku: 'LS-M-W', visible: true },
      stock: { inStock: false }
    }
  ],
  lastUpdated: '2026-08-29T10:15:00Z',
  stock: { inStock: true }
};

export const wixKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const WIX_PUBLIC_KEY_PEM = wixKeyPair.publicKey.export({
  type: 'spki',
  format: 'pem'
}) as string;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** Legacy-envelope Wix webhook JWT, signed with the test private key. */
export function wixWebhookJwt(
  event: { instanceId: string; eventType: string; productId?: string },
  opts: { key?: typeof wixKeyPair.privateKey; exp?: number; jti?: string } = {}
): string {
  const inner = event.productId ? JSON.stringify({ productId: event.productId }) : '{}';
  const claims = {
    data: JSON.stringify({ data: inner, instanceId: event.instanceId, eventType: event.eventType }),
    iat: Math.floor(Date.now() / 1000),
    exp: opts.exp ?? Math.floor(Date.now() / 1000) + 300,
    jti: opts.jti ?? Math.random().toString(36).slice(2)
  };
  const head = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
  const sig = sign('RSA-SHA256', Buffer.from(head), opts.key ?? wixKeyPair.privateKey);
  return `${head}.${sig.toString('base64url')}`;
}
