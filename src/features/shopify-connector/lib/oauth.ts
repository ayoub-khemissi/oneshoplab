/**
 * Public-app (OAuth) helpers, pure: env, authorize URL, Shopify's query HMAC.
 * Env: SHOPIFY_APP_CLIENT_ID / SHOPIFY_APP_CLIENT_SECRET / SHOPIFY_APP_SCOPES.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SHOPIFY_STATE_COOKIE = 'osl_shopify_oauth';
// `write_files` is what lets us set the alt text of a photo already on the
// store. Asked for up front, while the app is young: added later it would make
// every connected merchant re-consent, and a store without it simply keeps the
// smaller capability set.
export const DEFAULT_SHOPIFY_APP_SCOPES = [
  'read_products',
  'write_products',
  'write_files'
] as const;

/**
 * Scopes we ask for but do not require. `write_files` only unlocks editing the
 * alt text of a photo already on the store: a merchant who declines it should
 * still get a working connection with a smaller set of verbs, not a refusal.
 */
export const OPTIONAL_SHOPIFY_APP_SCOPES: readonly string[] = ['write_files'];

export interface ShopifyAppConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export function shopifyAppConfig(): ShopifyAppConfig | null {
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const scopes = (process.env.SHOPIFY_APP_SCOPES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    clientId,
    clientSecret,
    scopes: scopes.length ? scopes : [...DEFAULT_SHOPIFY_APP_SCOPES]
  };
}

export function isShopifyAppConfigured(): boolean {
  return shopifyAppConfig() !== null;
}

export function shopifyAuthorizeUrl(
  shopDomain: string,
  cfg: ShopifyAppConfig,
  redirectUri: string,
  state: string
): string {
  const qs = new URLSearchParams({
    client_id: cfg.clientId,
    scope: cfg.scopes.join(','),
    redirect_uri: redirectUri,
    state
  });
  return `https://${shopDomain}/admin/oauth/authorize?${qs.toString()}`;
}

/**
 * Shopify signs the callback query: HMAC-SHA256 (hex) over the remaining
 * params sorted by key and joined as `k=v&k=v`, with the client secret.
 */
export function computeShopifyQueryHmac(params: URLSearchParams, secret: string): string {
  const pairs: string[] = [];
  const keys = [...new Set([...params.keys()])].filter((k) => k !== 'hmac' && k !== 'signature');
  for (const k of keys.sort()) {
    const values = params.getAll(k);
    const v = values.length > 1 ? `["${values.join('", "')}"]` : (values[0] ?? '');
    pairs.push(
      `${k.replace(/[&%=]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}=${v.replace(/[&%]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
    );
  }
  return createHmac('sha256', secret).update(pairs.join('&')).digest('hex');
}

export function verifyShopifyQueryHmac(params: URLSearchParams, secret: string): boolean {
  const given = params.get('hmac');
  if (!given || !secret) return false;
  const expected = Buffer.from(computeShopifyQueryHmac(params, secret), 'hex');
  const got = Buffer.from(given, 'hex');
  return got.length === expected.length && got.length > 0 && timingSafeEqual(got, expected);
}

/** `write_x` implies `read_x` in Shopify's grant; everything else must match exactly. */
export function missingScopes(required: readonly string[], granted: readonly string[]): string[] {
  const have = new Set(granted);
  return required.filter((s) => !have.has(s) && !have.has(s.replace(/^read_/, 'write_')));
}
