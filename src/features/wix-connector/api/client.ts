/**
 * Minimal Wix REST client (fetch, no SDK). Access tokens live 5 minutes and
 * are minted from the permanent refresh token on demand; a 401/403 after a
 * fresh token means the app was removed → `token_invalid`.
 */
import { WIX_PRODUCTS_PAGE_SIZE, type WixProduct } from '../lib/map-product';

export const WIX_API_BASE = 'https://www.wixapis.com';
const TOKEN_TTL_MS = 4 * 60 * 1000;

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
  refreshToken: string;
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
  /** id → name, every collection of the store (one call per pull). */
  collections(): Promise<Map<string, string>>;
}

/** One-shot code → tokens (install) or refresh → access token; shared shape. */
export async function wixTokenRequest(
  body: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await fetchImpl(`${WIX_API_BASE}/oauth/access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 400 || res.status === 401 || res.status === 403)
    throw new WixClientError('token_invalid', `Wix refused the token (${res.status})`, res.status);
  if (!res.ok) throw new WixClientError('http', `Wix HTTP ${res.status}`, res.status);
  const json = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!json.access_token)
    throw new WixClientError('http', 'Wix token response without access_token');
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null };
}

export function createWixClient(opts: WixClientOptions): WixClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let accessToken: string | null = null;
  let mintedAt = 0;

  async function token(): Promise<string> {
    if (accessToken && Date.now() - mintedAt < TOKEN_TTL_MS) return accessToken;
    const t = await wixTokenRequest(
      {
        grant_type: 'refresh_token',
        client_id: opts.appId,
        client_secret: opts.appSecret,
        refresh_token: opts.refreshToken
      },
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
