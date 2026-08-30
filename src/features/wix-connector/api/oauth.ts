/**
 * Wix app install (OAuth, app started from OSL): installer redirect, then
 * `code` → refresh token (`POST /oauth/access`, authorization_code), sealed
 * with the instance id. Webhooks are configured once in the Dev Center
 * (per app, not per site), so nothing is registered here.
 */
import {
  connectWix,
  disconnect,
  getConnectionForUser,
  requestPull
} from '@/entities/shop-connection';
import { createOauthState, verifyOauthState, type OauthStatePayload } from '@/shared/lib';
import { wixAppConfig } from '../lib/config';
import { createWixClient, WixClientError, wixTokenRequest } from './client';

export function wixRedirectUrl(): string {
  const base = (process.env.APP_URL ?? '').replace(/\/+$/, '');
  return `${base}/api/integrations/wix/callback`;
}

export type BeginWixInstallResult =
  { ok: true; url: string; cookieValue: string } | { ok: false; reason: 'not_configured' };

export function beginWixInstall(input: {
  projectId: string;
  userId: string;
  locale: string;
  /** Present when Wix started the flow from the App Market (passed through). */
  token?: string | null;
}): BeginWixInstallResult {
  const cfg = wixAppConfig();
  if (!cfg) return { ok: false, reason: 'not_configured' };
  const { state, cookieValue } = createOauthState(
    { projectId: input.projectId, userId: input.userId, locale: input.locale },
    cfg.appSecret
  );
  const qs = new URLSearchParams({ appId: cfg.appId, redirectUrl: wixRedirectUrl(), state });
  if (input.token) qs.set('token', input.token);
  return { ok: true, url: `https://www.wix.com/installer/install?${qs.toString()}`, cookieValue };
}

export type CompleteWixInstallFailure =
  | 'not_configured'
  | 'bad_state'
  | 'unauthorized'
  | 'bad_request'
  | 'exchange_failed'
  | 'unreachable'
  | 'not_found'
  | 'no_key'
  | 'invalid_token';

export type CompleteWixInstallResult =
  | { ok: true; projectId: string; locale: string }
  | {
      ok: false;
      reason: CompleteWixInstallFailure;
      state: OauthStatePayload | null;
      error?: string;
    };

export async function completeWixInstall(
  input: { query: URLSearchParams; cookieValue: string | null; sessionUserId: string | null },
  deps: { fetchImpl?: typeof fetch; makeClient?: typeof createWixClient } = {}
): Promise<CompleteWixInstallResult> {
  const fail = (
    reason: CompleteWixInstallFailure,
    state: OauthStatePayload | null,
    error?: string
  ): CompleteWixInstallResult => ({ ok: false, reason, state, ...(error ? { error } : {}) });
  const cfg = wixAppConfig();
  if (!cfg) return fail('not_configured', null);
  const state = verifyOauthState(input.cookieValue, input.query.get('state'), cfg.appSecret);
  if (!state) return fail('bad_state', null);
  if (!input.sessionUserId || input.sessionUserId !== state.userId)
    return fail('unauthorized', state);
  const code = input.query.get('code') ?? '';
  const instanceId = input.query.get('instanceId') ?? '';
  if (!code || !instanceId) return fail('bad_request', state);

  const fetchImpl = deps.fetchImpl ?? fetch;
  let tokens: Awaited<ReturnType<typeof wixTokenRequest>>;
  try {
    tokens = await wixTokenRequest(
      {
        grant_type: 'authorization_code',
        client_id: cfg.appId,
        client_secret: cfg.appSecret,
        code
      },
      fetchImpl
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(
      e instanceof WixClientError && e.code === 'token_invalid' ? 'exchange_failed' : 'unreachable',
      state,
      msg
    );
  }
  if (!tokens.refreshToken) return fail('exchange_failed', state);

  const makeClient = deps.makeClient ?? createWixClient;
  let site: { siteDisplayName: string | null; host: string | null } = {
    siteDisplayName: null,
    host: null
  };
  try {
    site = await makeClient({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      refreshToken: tokens.refreshToken,
      fetchImpl
    }).siteInfo();
  } catch (e) {
    return fail('unreachable', state, e instanceof Error ? e.message : String(e));
  }
  const saved = await connectWix({
    projectId: state.projectId,
    userId: state.userId,
    instanceId,
    refreshToken: tokens.refreshToken,
    shopDomain: site.host ?? instanceId,
    shopName: site.siteDisplayName,
    scopes: ['WIX_STORES.MANAGE_PRODUCTS']
  });
  if (!saved.ok) return fail(saved.reason, state);
  await requestPull(state.projectId);
  return { ok: true, projectId: state.projectId, locale: state.locale };
}

/** "Disconnect": the refresh token is wiped; the merchant removes the app from Wix themselves. */
export async function disconnectWixStore(projectId: string, userId: string): Promise<boolean> {
  return disconnect(projectId, userId);
}

export async function requestWixPull(projectId: string, userId: string): Promise<boolean> {
  const c = await getConnectionForUser(projectId, userId);
  if (!c || c.platform !== 'wix' || c.status !== 'connected') return false;
  await requestPull(projectId);
  return true;
}
