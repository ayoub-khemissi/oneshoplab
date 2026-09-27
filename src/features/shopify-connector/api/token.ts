/**
 * Expiring offline tokens (required for public apps created after
 * 2026-04-01, for all public apps from 2027-01-01): the access token lives an
 * hour, the refresh token 90 days and rotates on every refresh.
 *
 * Every Admin API client built for a stored connection gets a token provider
 * from here. It returns the stored token while it has more than five minutes
 * left, and refreshes it otherwise, one process per store at a time, as
 * Shopify asks. A refused refresh surfaces as `token_invalid`, exactly like a
 * refused API call, so callers keep their single error path. A merchant who
 * opens the embedded app afterwards gets a new token by token exchange.
 */
import {
  claimShopifyTokenRefresh,
  readShopifyTokenGrant,
  releaseShopifyTokenRefresh,
  saveShopifyTokenGrant,
  type DecryptedSecrets,
  type ShopifyTokenGrant
} from '@/entities/shop-connection';
import { shopifyAppConfig } from '../lib/oauth';
import { parseShopifyTokenResponse, type ShopifyTokenResponse } from '../lib/token-grant';
import { ShopifyAdminError } from './admin-client';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const WAIT_STEP_MS = 500;
const WAIT_STEPS = 20;

export interface TokenDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}

export type RefreshOutcome =
  | { kind: 'ok'; grant: ShopifyTokenGrant }
  | { kind: 'terminal' }
  | { kind: 'transient'; error: string };

export async function requestShopifyTokenRefresh(
  shop: string,
  refreshToken: string,
  cfg: { clientId: string; clientSecret: string },
  deps: TokenDeps = {}
): Promise<RefreshOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });
  } catch (e) {
    return { kind: 'transient', error: e instanceof Error ? e.message : String(e) };
  }
  // Shopify answers every dead refresh token (replaced, expired, app
  // uninstalled) with the same 401; network errors, 429 and 5xx are safe to
  // retry with the token we still hold.
  if (res.status === 429 || res.status >= 500)
    return { kind: 'transient', error: `HTTP ${res.status}` };
  if (!res.ok) return { kind: 'terminal' };
  const parsed = parseShopifyTokenResponse(
    (await res.json()) as ShopifyTokenResponse,
    (deps.now ?? Date.now)()
  );
  return parsed
    ? { kind: 'ok', grant: parsed.grant }
    : { kind: 'transient', error: 'empty token response' };
}

function stillFresh(grant: { expiresAt: Date | null } | null, now: number): boolean {
  return Boolean(grant?.expiresAt && grant.expiresAt.getTime() - now > REFRESH_MARGIN_MS);
}

async function refreshStored(
  projectId: string,
  shop: string,
  refreshToken: string,
  deps: TokenDeps
): Promise<ShopifyTokenGrant> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const cfg = shopifyAppConfig();
  if (!cfg)
    throw new ShopifyAdminError('token_invalid', 'Shopify app not configured: cannot refresh');

  if (!(await claimShopifyTokenRefresh(projectId, new Date(now())))) {
    // Another process is refreshing this store: use what it stores.
    for (let i = 0; i < WAIT_STEPS; i++) {
      await sleep(WAIT_STEP_MS);
      const current = await readShopifyTokenGrant(projectId);
      if (current && stillFresh(current, now())) return current;
    }
    throw new ShopifyAdminError('network', 'Shopify token refresh still running elsewhere');
  }
  let saved = false;
  try {
    // Re-read under the lock: the previous holder may have just finished.
    const current = await readShopifyTokenGrant(projectId);
    if (current && stillFresh(current, now())) return current;
    const outcome = await requestShopifyTokenRefresh(
      shop,
      current?.refreshToken ?? refreshToken,
      cfg,
      deps
    );
    if (outcome.kind === 'terminal') {
      throw new ShopifyAdminError('token_invalid', 'Shopify refused the refresh token (401)', 401);
    }
    if (outcome.kind === 'transient') {
      throw new ShopifyAdminError('network', `Shopify token refresh failed: ${outcome.error}`);
    }
    await saveShopifyTokenGrant(projectId, outcome.grant);
    saved = true;
    return outcome.grant;
  } finally {
    if (!saved) await releaseShopifyTokenRefresh(projectId);
  }
}

/** `tokenProvider` for `createAdminClient` on a stored connection. */
export function shopifyTokenProvider(
  projectId: string,
  secrets: DecryptedSecrets,
  deps: TokenDeps = {}
): () => Promise<string> {
  const now = deps.now ?? Date.now;
  let grant: ShopifyTokenGrant = {
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    expiresAt: secrets.accessTokenExpiresAt,
    refreshExpiresAt: null
  };
  return async () => {
    // Custom-app tokens never expire and carry no refresh token.
    if (!grant.refreshToken || !grant.expiresAt || stillFresh(grant, now()))
      return grant.accessToken;
    try {
      grant = await refreshStored(projectId, secrets.shopDomain, grant.refreshToken, deps);
    } catch (e) {
      // A hiccup while the current token still works is not worth failing for.
      const usable = grant.expiresAt && grant.expiresAt.getTime() > now();
      if (usable && e instanceof ShopifyAdminError && e.code === 'network')
        return grant.accessToken;
      throw e;
    }
    return grant.accessToken;
  };
}
