/** In-memory Wix client; test files point `createWixClient` at `fakeState.current`. */
import type { WixClient, WixClientOptions, WixProduct } from '@/features/wix-connector';
import { WixClientError } from '@/features/wix-connector';
import { wixProductFixture } from '../unit/wix-fixtures';

export interface FakeWixClient extends WixClient {
  products: Map<string, WixProduct>;
  tokenInvalid: boolean;
  lastOptions: WixClientOptions | null;
  calls: {
    productUpdate: Array<Record<string, unknown>>;
    addMedia: Array<{ id: string; urls: string[] }>;
    productById: string[];
  };
}

export const REFRESH_TOKEN = 'wix-refresh-' + 'x'.repeat(40);
export const INSTANCE_ID = 'inst-0000-1111';

export function fakeWixProduct(id: string, patch: Partial<WixProduct> = {}): WixProduct {
  return { ...wixProductFixture, id, slug: `p-${id}`, ...patch };
}

export function createFakeWixClient(products: WixProduct[] = []): FakeWixClient {
  const map = new Map(products.map((p) => [p.id, p]));
  const guard = () => {
    if (client.tokenInvalid)
      throw new WixClientError('token_invalid', 'Wix refused the token (401)', 401);
  };
  const client: FakeWixClient = {
    products: map,
    tokenInvalid: false,
    lastOptions: null,
    calls: { productUpdate: [], addMedia: [], productById: [] },
    async request() {
      throw new Error('raw request not supported by the fake');
    },
    async siteInfo() {
      guard();
      return { siteDisplayName: 'Atelier Wix', host: 'atelier.wixsite.com' };
    },
    async productsPage(offset) {
      guard();
      const all = [...map.values()];
      return { products: all.slice(offset, offset + 100), total: all.length };
    },
    async productById(id) {
      guard();
      client.calls.productById.push(id);
      return map.get(id) ?? null;
    },
    async productUpdate(input) {
      guard();
      client.calls.productUpdate.push({ ...input });
      const p = map.get(input.id);
      if (p) {
        if (input.name !== undefined) p.name = input.name;
        if (input.description !== undefined) p.description = input.description;
        if (input.ribbon !== undefined) p.ribbon = input.ribbon;
      }
    },
    async productAddMedia(id, urls) {
      guard();
      client.calls.addMedia.push({ id, urls });
    },
    async collections() {
      guard();
      return new Map([['col-1', 'Shirts']]);
    }
  };
  return client;
}

export function setWixEnv(publicKey: string): void {
  process.env.WIX_APP_ID = 'wix-app-id';
  process.env.WIX_APP_SECRET = 'wix-app-secret-for-tests';
  process.env.WIX_APP_PUBLIC_KEY = publicKey;
}
