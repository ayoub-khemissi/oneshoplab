/**
 * Query params the OAuth callbacks land on (`?tab=integrations&connected=…`,
 * `&warning=…`, `&error=<reason>` — routes `api/integrations/{shopify,wix}/callback`
 * and `shopify/install`). Reasons must match `CompleteShopifyInstallFailure`
 * / `CompleteWixInstallFailure`; anything else is shown as `unknown`.
 */
export const SHOPIFY_RETURN_ERRORS = [
  'not_configured',
  'bad_hmac',
  'bad_state',
  'unauthorized',
  'invalid_domain',
  'exchange_failed',
  'scopes_missing',
  'unreachable',
  'not_found',
  'no_key'
] as const;
export type ShopifyReturnError = (typeof SHOPIFY_RETURN_ERRORS)[number] | 'unknown';

export const WIX_RETURN_ERRORS = [
  'not_configured',
  'bad_state',
  'unauthorized',
  'bad_request',
  'exchange_failed',
  'unreachable',
  'not_found',
  'no_key',
  'invalid_token'
] as const;
export type WixReturnError = (typeof WIX_RETURN_ERRORS)[number] | 'unknown';

export type IntegrationReturn =
  | { kind: 'none' }
  | { kind: 'connected'; platform: 'shopify' | 'wix'; warning: 'webhooks_failed' | null }
  | { kind: 'error'; reason: string };

export const RETURN_PARAM_KEYS = ['connected', 'warning', 'error'] as const;

type Params = Partial<Record<(typeof RETURN_PARAM_KEYS)[number], string | undefined>>;

export function parseIntegrationReturn(params: Params): IntegrationReturn {
  const connected = params.connected;
  if (connected === 'shopify' || connected === 'wix') {
    return {
      kind: 'connected',
      platform: connected,
      warning: params.warning === 'webhooks_failed' ? 'webhooks_failed' : null
    };
  }
  const error = (params.error ?? '').trim();
  if (error) return { kind: 'error', reason: error.slice(0, 40) };
  return { kind: 'none' };
}

export function shopifyReturnError(reason: string): ShopifyReturnError {
  return (SHOPIFY_RETURN_ERRORS as readonly string[]).includes(reason)
    ? (reason as ShopifyReturnError)
    : 'unknown';
}

export function wixReturnError(reason: string): WixReturnError {
  return (WIX_RETURN_ERRORS as readonly string[]).includes(reason)
    ? (reason as WixReturnError)
    : 'unknown';
}
