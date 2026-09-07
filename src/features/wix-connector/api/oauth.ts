/**
 * Wix app install, started from OneShopLab.
 *
 * Wix's external install flow: we send the merchant to
 * `https://www.wix.com/app-installer?appId&shareUrlId&postInstallationUrl`,
 * Wix runs its own consent screen, then redirects to `postInstallationUrl`
 * with `instanceId` and a `signedInstance` proving the install. There is no
 * code to exchange and no per-site token to keep — the credential for a site
 * is its `instanceId`, from which access tokens are minted on demand
 * (`client.ts`). Nothing is registered in the Dev Center per site; webhooks
 * are configured once, per app.
 *
 * A first version used custom authentication (`installer/install` →
 * `code` → refresh token). Wix no longer offers it to new apps: the Dev
 * Center has no redirect-URL field at all any more, and the installer
 * answers "no app with this redirect URL". Hence this flow (2026-09).
 */
import {
  connectWix,
  disconnect,
  getConnectionForUser,
  requestPull
} from '@/entities/shop-connection';
import { createOauthState, verifyOauthState, type OauthStatePayload } from '@/shared/lib';
import { wixAppConfig } from '../lib/config';
import { verifySignedInstance } from '../lib/signed-instance';
import { createWixClient } from './client';

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
}): BeginWixInstallResult {
  const cfg = wixAppConfig();
  if (!cfg) return { ok: false, reason: 'not_configured' };
  const { state, cookieValue } = createOauthState(
    { projectId: input.projectId, userId: input.userId, locale: input.locale },
    cfg.appSecret
  );
  // Our state rides on the callback URL: Wix preserves the query string of
  // `postInstallationUrl` and appends its own parameters to it.
  const callback = new URL(wixRedirectUrl());
  callback.searchParams.set('state', state);
  const qs = new URLSearchParams({ appId: cfg.appId });
  // Required while the app is unlisted: it is how Wix resolves an install
  // path that would otherwise come from an App Market listing.
  if (cfg.shareUrlId) qs.set('shareUrlId', cfg.shareUrlId);
  qs.set('postInstallationUrl', callback.toString());
  return { ok: true, url: `https://www.wix.com/app-installer?${qs.toString()}`, cookieValue };
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
  // `instanceId` arrives as plain text next to `signedInstance`; only the
  // signed copy proves an install happened, and only when the two agree.
  const instanceId = input.query.get('instanceId') ?? '';
  const signed = verifySignedInstance(input.query.get('signedInstance'), cfg.appSecret);
  if (!instanceId || !signed) return fail('bad_request', state);
  if (signed.instanceId !== instanceId) return fail('exchange_failed', state, 'instance mismatch');

  const fetchImpl = deps.fetchImpl ?? fetch;
  const makeClient = deps.makeClient ?? createWixClient;
  let site: { siteDisplayName: string | null; host: string | null } = {
    siteDisplayName: null,
    host: null
  };
  try {
    site = await makeClient({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      instanceId,
      fetchImpl
    }).siteInfo();
  } catch (e) {
    return fail('unreachable', state, e instanceof Error ? e.message : String(e));
  }
  const saved = await connectWix({
    projectId: state.projectId,
    userId: state.userId,
    instanceId,
    shopDomain: site.host ?? instanceId,
    shopName: site.siteDisplayName,
    scopes: ['WIX_STORES.MANAGE_PRODUCTS']
  });
  if (!saved.ok) return fail(saved.reason, state);
  await requestPull(state.projectId);
  return { ok: true, projectId: state.projectId, locale: state.locale };
}

/** "Disconnect": the instance is forgotten on our side; the merchant removes the app from Wix themselves. */
export async function disconnectWixStore(projectId: string, userId: string): Promise<boolean> {
  return disconnect(projectId, userId);
}

export async function requestWixPull(projectId: string, userId: string): Promise<boolean> {
  const c = await getConnectionForUser(projectId, userId);
  if (!c || c.platform !== 'wix' || c.status !== 'connected') return false;
  await requestPull(projectId);
  return true;
}
