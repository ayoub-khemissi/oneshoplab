/**
 * The public app as Shopify installs it (App Store, managed installation):
 * the merchant lands in our embedded page inside the Shopify admin with an ID
 * token and nothing else. Everything here starts from that token — no cookie,
 * no shop domain typed by anyone (App Store requirements 2.3.1 – 2.3.4).
 *
 *   ID token ─▶ token exchange (offline token) ─▶ shopify_shops row
 *            ─▶ new OneShopLab account      (onboardShopifyShop)
 *            ─▶ or an existing one          (createShopLinkToken → linkShopToUser)
 *            ─▶ project + shop connection   (same path as the OAuth install)
 */
import { and, eq } from 'drizzle-orm';
import { SHOPIFY_TEST_CREDIT_CAP } from '@/entities/ai-model';
import {
  connectShopify,
  createAccountFromStore,
  createStoreLinkToken,
  emailTaken,
  getConnection,
  loadStoreSummary,
  maskEmail,
  projectForStore,
  verifyStoreLinkToken,
  getShopifyShop,
  markShopifyShopLinked,
  openPendingGrant,
  recordShopifyInstall,
  requestPull,
  setLastError,
  type ShopifyShopFacts,
  type ShopifyShopRow,
  type ShopifyTokenGrant
} from '@/entities/shop-connection';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';
import { shopifyAppConfig, type ShopifyAppConfig } from '../lib/oauth';
import { adoptShopifyBilling } from './app-billing';
import { parseShopifyTokenResponse, type ShopifyTokenResponse } from '../lib/token-grant';
import { verifyShopifyIdToken } from '../lib/id-token';
import { createAdminClient, SHOPIFY_API_VERSION, ShopifyAdminError } from './admin-client';
import { registerShopifyWebhooks } from './webhooks';

export interface EmbeddedDeps {
  fetchImpl?: typeof fetch;
  makeClient?: typeof createAdminClient;
}

// ------------------------------------------------------------------ token exchange

export async function exchangeIdToken(
  shop: string,
  idToken: string,
  cfg: ShopifyAppConfig,
  fetchImpl: typeof fetch = fetch
): Promise<{ grant: ShopifyTokenGrant; scopes: string[] } | null> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    // Expiring offline token + refresh token (mandatory for our public app).
    expiring: '1'
  });
  const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body
  });
  if (!res.ok) return null;
  return parseShopifyTokenResponse((await res.json()) as ShopifyTokenResponse);
}

export async function fetchShopFacts(
  shop: string,
  accessToken: string,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<ShopifyShopFacts> {
  const client = makeClient({ shopDomain: shop, accessToken });
  const data = await client.request<{
    shop: {
      name: string | null;
      email: string | null;
      contactEmail: string | null;
      primaryDomain: { host: string | null } | null;
      plan: { partnerDevelopment: boolean | null } | null;
    };
    currentAppInstallation: { accessScopes: Array<{ handle: string }> } | null;
  }>(`query OslShopFacts {
  shop { name email contactEmail primaryDomain { host } plan { partnerDevelopment } }
  currentAppInstallation { accessScopes { handle } }
}`);
  return {
    shopName: data.shop.name ?? null,
    shopEmail: data.shop.email ?? data.shop.contactEmail ?? null,
    primaryDomain: data.shop.primaryDomain?.host?.toLowerCase() ?? null,
    partnerDevelopment: data.shop.plan?.partnerDevelopment === true,
    scopes: (data.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle)
  };
}

// ------------------------------------------------------------------ session

export type EmbeddedAuth =
  | { ok: true; shop: string; idToken: string; cfg: ShopifyAppConfig }
  | { ok: false; status: 401 | 503; error: 'not_configured' | 'unauthorized' };

export function authenticateEmbedded(idToken: string | null | undefined): EmbeddedAuth {
  const cfg = shopifyAppConfig();
  if (!cfg) return { ok: false, status: 503, error: 'not_configured' };
  const token = verifyShopifyIdToken(idToken, cfg);
  if (!token) return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true, shop: token.shop, idToken: idToken!, cfg };
}

async function connectionUsable(projectId: string | null): Promise<boolean> {
  if (!projectId) return false;
  const c = await getConnection(projectId);
  return Boolean(c && c.platform === 'shopify' && c.status === 'connected');
}

/**
 * Makes sure we hold a working offline token for the shop. The first call
 * after an install (or a reinstall) performs the token exchange; later calls
 * are a single row read. A reinstalled, previously linked shop is reconnected
 * to its project right away.
 */
export async function ensureEmbeddedInstall(
  auth: { shop: string; idToken: string; cfg: ShopifyAppConfig },
  deps: EmbeddedDeps = {}
): Promise<ShopifyShopRow> {
  const existing = await getShopifyShop(auth.shop);
  if (existing && !existing.uninstalledAt && existing.projectId) {
    if (await connectionUsable(existing.projectId)) return existing;
  }
  // Not linked yet: exchange again on every visit. Cheap, and a pending token
  // never outlives an uninstall + reinstall we did not hear about.
  const token = await exchangeIdToken(auth.shop, auth.idToken, auth.cfg, deps.fetchImpl);
  if (!token) throw new ShopifyAdminError('token_invalid', 'token exchange refused');
  const facts = await fetchShopFacts(auth.shop, token.grant.accessToken, deps.makeClient);
  const row = await recordShopifyInstall(auth.shop, facts, token.grant);
  if (row.userId) {
    // The shop already belongs to an account: reconnect its site, or give it
    // a new one when the merchant deleted it on the website. Asking them to
    // link the same account again would be a step for nothing.
    const project = row.projectId
      ? await db.query.projects.findFirst({
          where: and(eq(projects.id, row.projectId), eq(projects.userId, row.userId))
        })
      : null;
    const projectId = project?.id ?? (await projectFor(row.userId, row));
    await attachShopToProject(row, row.userId, projectId, token.grant, auth.cfg, deps);
    return (await getShopifyShop(auth.shop))!;
  }
  return row;
}

// ------------------------------------------------------------------ attach

async function attachShopToProject(
  row: ShopifyShopRow,
  userId: string,
  projectId: string,
  grant: ShopifyTokenGrant,
  cfg: ShopifyAppConfig,
  deps: EmbeddedDeps
): Promise<void> {
  const saved = await connectShopify({
    projectId,
    userId,
    shopDomain: row.shopDomain,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    accessTokenExpiresAt: grant.expiresAt,
    refreshTokenExpiresAt: grant.refreshExpiresAt,
    apiSecret: cfg.clientSecret,
    shopName: row.shopName,
    scopes: row.scopes ?? [],
    apiVersion: SHOPIFY_API_VERSION,
    authMode: 'oauth'
  });
  if (!saved.ok) throw new Error(`connectShopify: ${saved.reason}`);
  try {
    await registerShopifyWebhooks(projectId, deps.makeClient);
  } catch (e) {
    await setLastError(
      projectId,
      `webhook registration: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  await requestPull(projectId);
  await markShopifyShopLinked(row.shopDomain, userId, projectId);
}

/** The user's project for this shop, created when they have none yet. */
function projectFor(userId: string, row: ShopifyShopRow): Promise<string> {
  return projectForStore(userId, {
    domains: [row.primaryDomain, row.shopDomain],
    name: row.shopName,
    source: 'shopify'
  });
}

// ------------------------------------------------------------------ onboarding

export type OnboardResult =
  | { ok: true; userId: string; projectId: string }
  | { ok: false; reason: 'not_installed' | 'already_linked' | 'no_email' | 'email_taken' };

/**
 * First visit of a merchant who has no OneShopLab account: the account is
 * created from the shop (owner email, shop name), billed through Shopify from
 * now on, with the same welcome credits and the same recorded Terms consent
 * as a web signup — the merchant clicked "Create my space", which states it.
 */
export async function onboardShopifyShop(
  shop: string,
  opts: { locale?: string | null; cfg?: ShopifyAppConfig } & EmbeddedDeps = {}
): Promise<OnboardResult> {
  const cfg = opts.cfg ?? shopifyAppConfig();
  const row = await getShopifyShop(shop);
  if (!cfg || !row || row.uninstalledAt) return { ok: false, reason: 'not_installed' };
  if (row.userId && row.projectId) return { ok: false, reason: 'already_linked' };
  const token = openPendingGrant(row);
  if (!token) return { ok: false, reason: 'not_installed' };
  const email = row.shopEmail?.toLowerCase().trim() || null;
  if (!email) return { ok: false, reason: 'no_email' };
  if (await emailTaken(email)) return { ok: false, reason: 'email_taken' };

  const userId = await createAccountFromStore({
    email,
    name: row.shopName,
    locale: opts.locale ?? null,
    billingChannel: 'shopify'
  });
  const projectId = await projectFor(userId, row);
  await attachShopToProject(row, userId, projectId, token, cfg, opts);
  return { ok: true, userId, projectId };
}

// ------------------------------------------------------------------ linking an existing account

/** Short-lived, signed invitation to attach this shop to whoever logs in. */
export function createShopLinkToken(shop: string, now: number = Date.now()): string {
  return createStoreLinkToken('shopify', shop, now);
}

export function verifyShopLinkToken(
  token: string | null | undefined,
  now: number = Date.now()
): string | null {
  return verifyStoreLinkToken('shopify', token, now);
}

export type LinkResult =
  | { ok: true; projectId: string; shopName: string | null }
  | { ok: false; reason: 'bad_token' | 'not_installed' | 'linked_elsewhere' };

/** The logged-in user confirmed: this shop becomes one of their sites. */
export async function linkShopToUser(
  token: string,
  userId: string,
  opts: { cfg?: ShopifyAppConfig } & EmbeddedDeps = {}
): Promise<LinkResult> {
  const shop = verifyShopLinkToken(token);
  if (!shop) return { ok: false, reason: 'bad_token' };
  const cfg = opts.cfg ?? shopifyAppConfig();
  const row = await getShopifyShop(shop);
  if (!cfg || !row || row.uninstalledAt) return { ok: false, reason: 'not_installed' };
  if (row.userId && row.userId !== userId && row.projectId)
    return { ok: false, reason: 'linked_elsewhere' };
  if (row.userId === userId && row.projectId && (await connectionUsable(row.projectId))) {
    return { ok: true, projectId: row.projectId, shopName: row.shopName };
  }
  const grant = openPendingGrant(row);
  if (!grant) return { ok: false, reason: 'not_installed' };
  const projectId = await projectFor(userId, row);
  await attachShopToProject(row, userId, projectId, grant, cfg, opts);
  await adoptShopifyBilling(userId);
  return { ok: true, projectId, shopName: row.shopName };
}

// ------------------------------------------------------------------ state for the embedded page

export interface EmbeddedReadyState {
  kind: 'ready';
  shop: string;
  shopName: string | null;
  projectId: string;
  billingChannel: 'stripe' | 'shopify' | 'wix';
  plan: string;
  cycle: string | null;
  subscriptionStatus: string | null;
  currentPeriodEndIso: string | null;
  credits: number;
  products: number;
  lastPullAtIso: string | null;
  pulling: boolean;
  score: number | null;
  pendingChanges: number;
  testCharges: boolean;
  testCreditCap: number;
}

export type EmbeddedState =
  | {
      kind: 'onboarding';
      shop: string;
      shopName: string | null;
      email: string | null;
      emailTaken: boolean;
    }
  | EmbeddedReadyState;

export async function loadEmbeddedState(row: ShopifyShopRow): Promise<EmbeddedState> {
  if (!row.userId || !row.projectId) {
    return {
      kind: 'onboarding',
      shop: row.shopDomain,
      shopName: row.shopName,
      email: maskEmail(row.shopEmail),
      emailTaken: await emailTaken(row.shopEmail)
    };
  }
  const summary = await loadStoreSummary(row.userId, row.projectId);
  return {
    kind: 'ready',
    shop: row.shopDomain,
    shopName: row.shopName ?? summary.projectName,
    projectId: row.projectId,
    billingChannel: summary.billingChannel,
    plan: summary.plan,
    cycle: summary.cycle,
    subscriptionStatus: summary.subscriptionStatus,
    currentPeriodEndIso: summary.currentPeriodEndIso,
    credits: summary.credits,
    products: summary.products,
    lastPullAtIso: summary.lastPullAtIso,
    pulling: summary.pulling,
    score: summary.score,
    pendingChanges: summary.pendingChanges,
    testCharges: row.partnerDevelopment,
    testCreditCap: SHOPIFY_TEST_CREDIT_CAP
  };
}
