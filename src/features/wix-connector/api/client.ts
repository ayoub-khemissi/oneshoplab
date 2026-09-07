/**
 * Minimal Wix REST client (fetch, no SDK).
 *
 * Authentication is OAuth client credentials: there is no per-site secret at
 * all. An access token is minted from the app id, the app secret and the
 * site's `instanceId` (`POST /oauth2/token`), lives four hours, and is simply
 * minted again when it expires. A 401/403 on a fresh token means the app was
 * removed from the site → `token_invalid`.
 */
import { WIX_PRODUCTS_PAGE_SIZE, type WixProduct } from '../lib/map-product';

export const WIX_API_BASE = 'https://www.wixapis.com';
/** Wix says four hours; renew well before, so a long pull never straddles it. */
const TOKEN_TTL_MS = 3 * 60 * 60 * 1000 + 30 * 60 * 1000;

export type WixClientErrorCode = 'token_invalid' | 'http' | 'network';

export class WixClientError extends Error {
  constructor(
    public readonly code: WixClientErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'WixClientError';
  }
}

export interface WixSiteInfo {
  siteDisplayName: string | null;
  /** Hostname of the published site, null when unpublished. */
  host: string | null;
}

export interface WixProductsPage {
  products: WixProduct[];
  total: number;
}

export interface WixProductUpdateInput {
  id: string;
  name?: string;
  description?: string;
  ribbon?: string;
}

export interface WixClientOptions {
  appId: string;
  appSecret: string;
  /** The app's installation on this site — the whole credential. */
  instanceId: string;
  fetchImpl?: typeof fetch;
}

export interface WixClient {
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  siteInfo(): Promise<WixSiteInfo>;
  productsPage(offset: number): Promise<WixProductsPage>;
  productById(id: string): Promise<WixProduct | null>;
  productUpdate(input: WixProductUpdateInput): Promise<void>;
  /** External URLs (R2): Wix downloads them. */
  productAddMedia(id: string, urls: string[]): Promise<void>;
  /** Detaches media from the product; the files stay in the Wix media manager. */
  productRemoveMedia(id: string, mediaIds: string[]): Promise<void>;
  /** id → name, every collection of the store (one call per pull). */
  collections(): Promise<Map<string, string>>;
}

/** `POST /oauth2/token`, client credentials: app id + app secret + instance id → access token. */
export async function wixTokenRequest(
  input: { appId: string; appSecret: string; instanceId: string },
  fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string }> {
  const res = await fetchImpl(`${WIX_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: input.appId,
      client_secret: input.appSecret,
      instance_id: input.instanceId
    })
  });
  if (res.status === 400 || res.status === 401 || res.status === 403)
    throw new WixClientError('token_invalid', `Wix refused the token (${res.status})`, res.status);
  if (!res.ok) throw new WixClientError('http', `Wix HTTP ${res.status}`, res.status);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token)
    throw new WixClientError('http', 'Wix token response without access_token');
  return { accessToken: json.access_token };
}

export function createWixClient(opts: WixClientOptions): WixClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let accessToken: string | null = null;
  let mintedAt = 0;

  async function token(): Promise<string> {
    if (accessToken && Date.now() - mintedAt < TOKEN_TTL_MS) return accessToken;
    const t = await wixTokenRequest(
      { appId: opts.appId, appSecret: opts.appSecret, instanceId: opts.instanceId },
      fetchImpl
    );
    accessToken = t.accessToken;
    mintedAt = Date.now();
    return accessToken;
  }

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${WIX_API_BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: { 'content-type': 'application/json', authorization: await token() },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      });
    } catch (e) {
      if (e instanceof WixClientError) throw e;
      throw new WixClientError('network', `Wix unreachable: ${(e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403)
      throw new WixClientError(
        'token_invalid',
        `Wix refused the token (${res.status})`,
        res.status
      );
    if (res.status === 404) return null as T;
    if (!res.ok) throw new WixClientError('http', `Wix HTTP ${res.status} on ${path}`, res.status);
    return (await res.json()) as T;
  }

  return {
    request,
    async siteInfo() {
      const data = await request<{
        site?: { siteDisplayName?: string; url?: string };
      } | null>('/apps/v1/instance');
      let host: string | null = null;
      try {
        host = data?.site?.url ? new URL(data.site.url).hostname : null;
      } catch {
        host = null;
      }
      return { siteDisplayName: data?.site?.siteDisplayName ?? null, host };
    },
    async productsPage(offset) {
      const data = await request<{ products?: WixProduct[]; totalResults?: number }>(
        '/stores/v1/products/query',
        {
          method: 'POST',
          body: {
            query: { paging: { limit: WIX_PRODUCTS_PAGE_SIZE, offset } },
            includeVariants: true
          }
        }
      );
      return { products: data?.products ?? [], total: data?.totalResults ?? 0 };
    },
    async productById(id) {
      const data = await request<{ product?: WixProduct } | null>(
        `/stores/v1/products/${encodeURIComponent(id)}`
      );
      return data?.product ?? null;
    },
    async productUpdate({ id, ...product }) {
      await request(`/stores/v1/products/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { product }
      });
    },
    async productAddMedia(id, urls) {
      await request(`/stores/v1/products/${encodeURIComponent(id)}/media`, {
        method: 'POST',
        body: { media: urls.map((url) => ({ url })) }
      });
    },
    async productRemoveMedia(id, mediaIds) {
      await request(`/stores/v1/products/${encodeURIComponent(id)}/media/delete`, {
        method: 'POST',
        body: { mediaIds }
      });
    },
    async collections() {
      const out = new Map<string, string>();
      for (let offset = 0; offset < 1000; offset += 100) {
        const data = await request<{ collections?: Array<{ id: string; name?: string }> }>(
          '/stores/v1/collections/query',
          { method: 'POST', body: { query: { paging: { limit: 100, offset } } } }
        );
        const page = data?.collections ?? [];
        for (const c of page) if (c.name) out.set(c.id, c.name);
        if (page.length < 100) break;
      }
      return out;
    }
  };
}
