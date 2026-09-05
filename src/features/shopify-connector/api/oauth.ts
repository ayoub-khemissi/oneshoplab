/**
 * Public Shopify app: install (authorize redirect) and callback (code →
 * offline token → sealed row `auth_mode = 'oauth'`). Webhooks use the app's
 * client secret as HMAC key, so it is stored as the connection's webhook
 * secret and the mandatory `app/uninstalled` topic is registered too.
 */
import {
  connectShopify,
  normalizeShopDomain,
  requestPull,
  setLastError
} from '@/entities/shop-connection';
import { createOauthState, verifyOauthState, type OauthStatePayload } from '@/shared/lib';
import {
  missingScopes,
  OPTIONAL_SHOPIFY_APP_SCOPES,
  shopifyAppConfig,
  shopifyAuthorizeUrl,
  verifyShopifyQueryHmac
} from '../lib/oauth';
import { createAdminClient, SHOPIFY_API_VERSION, ShopifyAdminError } from './admin-client';
import { registerShopifyWebhooks } from './webhooks';

export function shopifyRedirectUri(): string {
  const base = (process.env.APP_URL ?? '').replace(/\/+$/, '');
  return `${base}/api/integrations/shopify/callback`;
}

export type BeginShopifyInstallResult =
  | { ok: true; url: string; cookieValue: string }
  | { ok: false; reason: 'not_configured' | 'invalid_domain' };

/** Builds the authorize URL + the signed state the route stores in a cookie. */
export function beginShopifyInstall(input: {
  projectId: string;
  userId: string;
  shop: string;
  locale: string;
}): BeginShopifyInstallResult {
  const cfg = shopifyAppConfig();
  if (!cfg) return { ok: false, reason: 'not_configured' };
  const shopDomain = normalizeShopDomain(input.shop);
  if (!shopDomain) return { ok: false, reason: 'invalid_domain' };
  const { state, cookieValue } = createOauthState(
    { projectId: input.projectId, userId: input.userId, locale: input.locale, subject: shopDomain },
    cfg.clientSecret
  );
  return {
    ok: true,
    url: shopifyAuthorizeUrl(shopDomain, cfg, shopifyRedirectUri(), state),
    cookieValue
  };
}

export type CompleteShopifyInstallFailure =
  | 'not_configured'
  | 'bad_hmac'
  | 'bad_state'
  | 'unauthorized'
  | 'invalid_domain'
  | 'exchange_failed'
  | 'scopes_missing'
  | 'unreachable'
  | 'not_found'
  | 'no_key';

export type CompleteShopifyInstallResult =
  | { ok: true; projectId: string; locale: string; webhooks: 'registered' | 'failed' }
  | {
      ok: false;
      reason: CompleteShopifyInstallFailure;
      state: OauthStatePayload | null;
      error?: string;
    };

interface TokenResponse {
  access_token?: string;
  scope?: string;
}

async function exchangeCode(
  shopDomain: string,
  code: string,
  cfg: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch
): Promise<{ accessToken: string; scopes: string[] } | null> {
  const res = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code })
  });
  if (!res.ok) return null;
  const body = (await res.json()) as TokenResponse;
  if (!body.access_token) return null;
  return {
    accessToken: body.access_token,
    scopes: (body.scope ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
}

export async function completeShopifyInstall(
  input: { query: URLSearchParams; cookieValue: string | null; sessionUserId: string | null },
  deps: { fetchImpl?: typeof fetch; makeClient?: typeof createAdminClient } = {}
): Promise<CompleteShopifyInstallResult> {
  const cfg = shopifyAppConfig();
  const fail = (
    reason: CompleteShopifyInstallFailure,
    state: OauthStatePayload | null,
    error?: string
  ): CompleteShopifyInstallResult => ({ ok: false, reason, state, ...(error ? { error } : {}) });
  if (!cfg) return fail('not_configured', null);
  const state = verifyOauthState(input.cookieValue, input.query.get('state'), cfg.clientSecret);
  if (!state) return fail('bad_state', null);
  if (!verifyShopifyQueryHmac(input.query, cfg.clientSecret)) return fail('bad_hmac', state);
  if (!input.sessionUserId || input.sessionUserId !== state.userId)
    return fail('unauthorized', state);
  const shopDomain = normalizeShopDomain(input.query.get('shop') ?? '');
  const code = input.query.get('code') ?? '';
  if (!shopDomain || shopDomain !== state.subject || !code) return fail('invalid_domain', state);

  const fetchImpl = deps.fetchImpl ?? fetch;
  let token: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    token = await exchangeCode(shopDomain, code, cfg, fetchImpl);
  } catch (e) {
    return fail('unreachable', state, e instanceof Error ? e.message : String(e));
  }
  if (!token) return fail('exchange_failed', state);
  const missing = missingScopes(
    cfg.scopes.filter((s) => !OPTIONAL_SHOPIFY_APP_SCOPES.includes(s)),
    token.scopes
  );
  if (missing.length) return fail('scopes_missing', state, missing.join(','));

  const makeClient = deps.makeClient ?? createAdminClient;
  let shopName: string | null = null;
  try {
    shopName = (await makeClient({ shopDomain, accessToken: token.accessToken }).shopInfo()).name;
  } catch (e) {
    if (e instanceof ShopifyAdminError && e.code === 'token_invalid')
      return fail('exchange_failed', state, e.message);
    return fail('unreachable', state, e instanceof Error ? e.message : String(e));
  }

  const saved = await connectShopify({
    projectId: state.projectId,
    userId: state.userId,
    shopDomain,
    accessToken: token.accessToken,
    apiSecret: cfg.clientSecret,
    shopName,
    scopes: token.scopes,
    apiVersion: SHOPIFY_API_VERSION,
    authMode: 'oauth'
  });
  if (!saved.ok) {
    return fail(
      saved.reason === 'no_key'
        ? 'no_key'
        : saved.reason === 'not_found'
          ? 'not_found'
          : 'exchange_failed',
      state
    );
  }
  let webhooks: 'registered' | 'failed' = 'registered';
  try {
    await registerShopifyWebhooks(state.projectId, makeClient);
  } catch (e) {
    webhooks = 'failed';
    await setLastError(
      state.projectId,
      `webhook registration: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  await requestPull(state.projectId);
  return { ok: true, projectId: state.projectId, locale: state.locale, webhooks };
}
