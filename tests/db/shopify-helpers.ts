/**
 * In-memory stand-in for the Admin GraphQL client. Test files install it with
 * `vi.mock('@/features/shopify-connector/api/admin-client', …)` and point
 * `createAdminClient` at `fakeState.current`.
 */
import { createHmac } from 'node:crypto';
import {
  PRODUCTS_PAGE_SIZE,
  ShopifyAdminError,
  type AdminClientOptions,
  type AdminProduct,
  type ShopInfo,
  type ShopifyAdminClient
} from '@/features/shopify-connector';
import { adminProductFixture } from '../unit/shopify-fixtures';

export interface FakeAdminClient extends ShopifyAdminClient {
  products: Map<string, AdminProduct>;
  tokenInvalid: boolean;
  calls: {
    productUpdate: Array<Record<string, unknown>>;
    productCreateMedia: Array<{ id: string; media: unknown[] }>;
    webhookCreate: Array<{ topic: string; url: string }>;
    webhookDelete: string[];
    productById: string[];
  };
  lastOptions: AdminClientOptions | null;
}

export const SHOP: ShopInfo = {
  name: 'Atelier',
  myshopifyDomain: 'atelier.myshopify.com',
  currencyCode: 'EUR',
  scopes: ['read_products', 'write_products']
};

export function fakeProduct(id: string, patch: Partial<AdminProduct> = {}): AdminProduct {
  return {
    ...adminProductFixture,
    id: `gid://shopify/Product/${id}`,
    handle: `p-${id}`,
    onlineStoreUrl: null,
    ...patch
  };
}

export function createFakeClient(products: AdminProduct[] = []): FakeAdminClient {
  const map = new Map(products.map((p) => [p.id.split('/').pop() ?? p.id, p]));
  let nextWebhook = 1;
  const guard = () => {
    if (client.tokenInvalid)
      throw new ShopifyAdminError('token_invalid', 'Shopify refused the token (401)', 401);
  };
  const client: FakeAdminClient = {
    products: map,
    tokenInvalid: false,
    lastOptions: null,
    calls: {
      productUpdate: [],
      productCreateMedia: [],
      webhookCreate: [],
      webhookDelete: [],
      productById: []
    },
    throttle: () => null,
    async request() {
      throw new Error('raw request not supported by the fake');
    },
    async shopInfo() {
      guard();
      return SHOP;
    },
    async productsPage(cursor) {
      guard();
      const all = [...map.values()];
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + PRODUCTS_PAGE_SIZE);
      const end = start + page.length;
      return { products: page, endCursor: String(end), hasNextPage: end < all.length };
    },
    async productById(id) {
      guard();
      const key = id.split('/').pop() ?? id;
      client.calls.productById.push(key);
      return map.get(key) ?? null;
    },
    async productUpdate(input) {
      guard();
      client.calls.productUpdate.push({ ...input });
      const key = input.id.split('/').pop() ?? input.id;
      const p = map.get(key);
      if (p) {
        if (input.title !== undefined) p.title = input.title;
        if (input.descriptionHtml !== undefined) p.descriptionHtml = input.descriptionHtml;
        if (input.tags !== undefined) p.tags = input.tags;
      }
    },
    async productCreateMedia(id, media) {
      guard();
      client.calls.productCreateMedia.push({ id, media });
    },
    async webhookSubscriptionCreate(topic, url) {
      guard();
      client.calls.webhookCreate.push({ topic, url });
      return `gid://shopify/WebhookSubscription/${nextWebhook++}`;
    },
    async webhookSubscriptionDelete(id) {
      guard();
      client.calls.webhookDelete.push(id);
    }
  };
  return client;
}

// Deliberately NOT a valid-looking token: GitHub push protection matches shpat_ + 32 hex chars.
export const TOKEN = 'shpat_' + 'x'.repeat(32);
export const API_SECRET = 'shpss_api_secret_key_for_tests';

export function shopifyHeaders(
  rawBody: string,
  topic: string,
  opts: { secret?: string; webhookId?: string } = {}
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-shopify-topic': topic,
    'x-shopify-shop-domain': SHOP.myshopifyDomain,
    'x-shopify-webhook-id': opts.webhookId ?? `wh-${Math.random().toString(36).slice(2)}`,
    'x-shopify-hmac-sha256': createHmac('sha256', opts.secret ?? API_SECRET)
      .update(rawBody)
      .digest('base64')
  };
}
