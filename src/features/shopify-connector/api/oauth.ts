/**
 * Public Shopify app: install (authorize redirect) and callback (code →
 * offline token → sealed row `auth_mode = 'oauth'`). Webhooks use the app's
 * client secret as HMAC key, so it is stored as the connection's webhook
 * secret and the mandatory `app/uninstalled` topic is registered too.
 */
import {
  connectShopify,
  getShopifyShop,
  markShopifyShopLinked,
  normalizeShopDomain,
  recordShopifyInstall,
  requestPull,
  setLastError,
  type ShopifyTokenGrant
} from '@/entities/shop-connection';
import { createOauthState, verifyOauthState, type OauthStatePayload } from '@/shared/lib';
import {
  missingScopes,
  OPTIONAL_SHOPIFY_APP_SCOPES,
  shopifyAppConfig,
  shopifyAuthorizeUrl,
  verifyShopifyQueryHmac
} from '../lib/oauth';
import { parseShopifyTokenResponse, type ShopifyTokenResponse } from '../lib/token-grant';
import { createAdminClient, SHOPIFY_API_VERSION, ShopifyAdminError } from './admin-client';
import { adoptShopifyBilling } from './app-billing';
import { fetchShopFacts } from './embedded';
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

async function exchangeCode(
  shopDomain: string,
  code: string,
  cfg: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch
): Promise<{ grant: ShopifyTokenGrant; scopes: string[] } | null> {
  const res = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    // expiring: 1 → an offline token that expires after an hour, with a
    // refresh token (mandatory for our public app, see api/token.ts).
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      expiring: 1
    })
  });
  if (!res.ok) return null;
  return parseShopifyTokenResponse((await res.json()) as ShopifyTokenResponse);
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
    shopName = (await makeClient({ shopDomain, accessToken: token.grant.accessToken }).shopInfo())
      .name;
  } catch (e) {
    if (e instanceof ShopifyAdminError && e.code === 'token_invalid')
      return fail('exchange_failed', state, e.message);
    return fail('unreachable', state, e instanceof Error ? e.message : String(e));
  }

  const saved = await connectShopify({
    projectId: state.projectId,
    userId: state.userId,
    shopDomain,
    accessToken: token.grant.accessToken,
    refreshToken: token.grant.refreshToken,
    accessTokenExpiresAt: token.grant.expiresAt,
    refreshTokenExpiresAt: token.grant.refreshExpiresAt,
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
  if (
    await registerWebInstall(
      shopDomain,
      state.userId,
      state.projectId,
      token.grant.accessToken,
      makeClient
    )
  ) {
    await adoptShopifyBilling(state.userId);
  }
  return { ok: true, projectId: state.projectId, locale: state.locale, webhooks };
}

/**
 * The website's "connect my store" installs the same public app as the App
 * Store, so the shop joins the same registry: uninstall, test charges and
 * Shopify Billing (1.2.1) then work the same for both ways in. A shop another
 * account already owns stays theirs. False when the shop could not be
 * registered — the account then keeps web billing rather than a Shopify
 * billing it could not use.
 */
async function registerWebInstall(
  shopDomain: string,
  userId: string,
  projectId: string,
  accessToken: string,
  makeClient: typeof createAdminClient
): Promise<boolean> {
  const existing = await getShopifyShop(shopDomain);
  if (existing?.userId && existing.userId !== userId && !existing.uninstalledAt) return false;
  try {
    await recordShopifyInstall(
      shopDomain,
      await fetchShopFacts(shopDomain, accessToken, makeClient),
      null
    );
  } catch (e) {
    await setLastError(projectId, `shop registry: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  await markShopifyShopLinked(shopDomain, userId, projectId);
  return true;
}
