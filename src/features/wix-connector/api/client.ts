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
import { htmlToRichContent } from '../lib/rich-content';
import { fromV3Product, V3_PRODUCT_FIELDS, type V3Product } from '../lib/v3-product';

/**
 * Which Wix Stores catalogue a site runs. The two are not compatible — V1
 * answers 428 to a V3 site and vice versa — and every new site is V3. Detected
 * once per client from `GET /stores/v3/provision/version`; if that call is
 * refused (it needs a scope of its own), the first V1 call's 428 settles it.
 */
export type CatalogVersion = 'v1' | 'v3' | 'unknown';

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
  /** Site language (ISO 639-1) from Site Properties, null when unavailable. */
  language: string | null;
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
  /** Skip detection when the caller already knows (tests, or a stored value). */
  catalogVersion?: CatalogVersion;
}

export interface WixClient {
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  /** Which catalogue the site runs — resolved on first use. */
  catalogVersion(): Promise<CatalogVersion>;
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
    if (!res.ok) {
      // Wix puts the reason in the body (`message`, or `details.applicationError`):
      // 428 with nothing else is how a missing permission looked to us.
      const detail = await res.text().then(
        (t) => t.replace(/\s+/g, ' ').slice(0, 200),
        () => ''
      );
      throw new WixClientError(
        'http',
        `Wix HTTP ${res.status} on ${path}${detail ? ` — ${detail}` : ''}`,
        res.status
      );
    }
    return (await res.json()) as T;
  }

  // ---- catalogue version -------------------------------------------------
  let version: CatalogVersion = opts.catalogVersion ?? 'unknown';
  async function catalogVersion(): Promise<CatalogVersion> {
    if (version !== 'unknown') return version;
    try {
      const d = await request<{ catalogVersion?: string } | null>('/stores/v3/provision/version');
      if (d?.catalogVersion === 'V3_CATALOG') version = 'v3';
      else if (d?.catalogVersion === 'V1_CATALOG') version = 'v1';
    } catch (e) {
      // A refused token is a refused token. Anything else (typically a missing
      // scope for this one endpoint) leaves the question to the first V1 call.
      if (e instanceof WixClientError && e.code === 'token_invalid') throw e;
    }
    return version;
  }
  /** Run the V1 path unless the site is (or turns out to be) V3. */
  async function byVersion<T>(v1: () => Promise<T>, v3: () => Promise<T>): Promise<T> {
    if ((await catalogVersion()) === 'v3') return v3();
    try {
      return await v1();
    } catch (e) {
      if (e instanceof WixClientError && e.status === 428 && /CATALOG_V3/.test(e.message)) {
        version = 'v3';
        return v3();
      }
      throw e;
    }
  }

  // ---- V3 primitives -----------------------------------------------------
  const v3Fields = () => V3_PRODUCT_FIELDS.map((f) => `fields=${f}`).join('&');
  async function v3Get(id: string, withFields: boolean): Promise<V3Product | null> {
    const q = withFields ? `?${v3Fields()}` : '';
    const d = await request<{ product?: V3Product } | null>(
      `/stores/v3/products/${encodeURIComponent(id)}${q}`
    );
    return d?.product ?? null;
  }
  /** V3 updates are optimistic-locked: read the revision, then patch. */
  async function v3Patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const current = await v3Get(id, false);
    if (!current) throw new WixClientError('http', `Wix product ${id} not found`, 404);
    await request(`/stores/v3/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { product: { id, revision: current.revision, ...patch } }
    });
  }
  /** Media in V3 is one array, fully overwritten: keep existing by id, add by url. */
  async function v3SetMedia(
    id: string,
    edit: (items: Array<{ id?: string }>) => Array<{ id?: string; url?: string }>
  ) {
    const current = await v3Get(id, true);
    if (!current) throw new WixClientError('http', `Wix product ${id} not found`, 404);
    const existing = (current.media?.itemsInfo?.items ?? [])
      .map((m) => ({ id: m.id ?? m.image?.id }))
      .filter((m): m is { id: string } => !!m.id);
    await request(`/stores/v3/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: {
        product: { id, revision: current.revision, media: { itemsInfo: { items: edit(existing) } } }
      }
    });
  }
  // V3 pages by cursor; the interface pages by offset. The pull walks pages in
  // order from 0, so the cursor for "offset N" is the one the previous page
  // handed back.
  const cursors = new Map<number, string>();

  return {
    request,
    catalogVersion,
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
      // Site Properties carries the language the storefront is written in.
      // It only needs the app's own scope, but a refusal must not cost the
      // caller the rest of the answer — the language is a hint, not a gate.
      let language: string | null = null;
      try {
        const props = await request<{
          properties?: { language?: string | null; locale?: { languageCode?: string | null } };
        } | null>('/site-properties/v4/properties?fields.paths=language&fields.paths=locale');
        language = props?.properties?.language ?? props?.properties?.locale?.languageCode ?? null;
      } catch (e) {
        if (e instanceof WixClientError && e.code !== 'http') throw e;
        console.warn('[wix] site properties unavailable, language unknown:', (e as Error).message);
      }
      return { siteDisplayName: data?.site?.siteDisplayName ?? null, host, language };
    },
    productsPage(offset) {
      return byVersion(
        async () => {
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
        async () => {
          const cursor = offset === 0 ? undefined : cursors.get(offset);
          if (offset !== 0 && !cursor) return { products: [], total: offset };
          const data = await request<{
            products?: V3Product[];
            pagingMetadata?: { cursors?: { next?: string }; total?: number; hasNext?: boolean };
          } | null>('/stores/v3/products/query', {
            method: 'POST',
            body: {
              fields: [...V3_PRODUCT_FIELDS],
              query: {
                cursorPaging: { limit: WIX_PRODUCTS_PAGE_SIZE, ...(cursor ? { cursor } : {}) }
              }
            }
          });
          const products = (data?.products ?? []).map(fromV3Product);
          const meta = data?.pagingMetadata;
          if (meta?.cursors?.next) cursors.set(offset + WIX_PRODUCTS_PAGE_SIZE, meta.cursors.next);
          // `total` can be withheld on big catalogues; the pull only needs a
          // number that says "there is more" while `hasNext` is true.
          const total =
            meta?.total ??
            (meta?.hasNext ? offset + products.length + 1 : offset + products.length);
          return { products, total };
        }
      );
    },
    productById(id) {
      return byVersion(
        async () => {
          const data = await request<{ product?: WixProduct } | null>(
            `/stores/v1/products/${encodeURIComponent(id)}`
          );
          return data?.product ?? null;
        },
        async () => {
          const p = await v3Get(id, true);
          return p ? fromV3Product(p) : null;
        }
      );
    },
    productUpdate({ id, ...product }) {
      return byVersion(
        async () => {
          await request(`/stores/v1/products/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: { product }
          });
        },
        async () => {
          const patch: Record<string, unknown> = {};
          if (product.name !== undefined) patch.name = product.name;
          // V3 writes descriptions as rich content only; our HTML is converted.
          if (product.description !== undefined)
            patch.description = htmlToRichContent(product.description);
          // A ribbon by name: Wix reuses it when it exists and creates it otherwise.
          if (product.ribbon !== undefined)
            patch.ribbon = product.ribbon ? { name: product.ribbon } : null;
          await v3Patch(id, patch);
        }
      );
    },
    productAddMedia(id, urls) {
      return byVersion(
        async () => {
          await request(`/stores/v1/products/${encodeURIComponent(id)}/media`, {
            method: 'POST',
            body: { media: urls.map((url) => ({ url })) }
          });
        },
        () => v3SetMedia(id, (items) => [...items, ...urls.map((url) => ({ url }))])
      );
    },
    productRemoveMedia(id, mediaIds) {
      return byVersion(
        async () => {
          await request(`/stores/v1/products/${encodeURIComponent(id)}/media/delete`, {
            method: 'POST',
            body: { mediaIds }
          });
        },
        () => v3SetMedia(id, (items) => items.filter((m) => !m.id || !mediaIds.includes(m.id)))
      );
    },
    collections() {
      return byVersion(
        async () => {
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
        },
        // V3 products carry their category name in the breadcrumbs we request,
        // so there is nothing to look up.
        async () => new Map<string, string>()
      );
    }
  };
}
