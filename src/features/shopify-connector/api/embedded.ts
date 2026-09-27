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
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, eq, isNotNull } from 'drizzle-orm';
import { SIGNUP_FREE_CREDITS } from '@/entities/ai-model';
import { applyCreditTransaction } from '@/entities/credit';
import { LEGAL_TERMS_VERSION } from '@/entities/legal-consent';
import {
  connectShopify,
  getConnection,
  getShopifyShop,
  markShopifyShopLinked,
  openPendingToken,
  recordShopifyInstall,
  requestPull,
  setLastError,
  type ShopifyShopFacts,
  type ShopifyShopRow
} from '@/entities/shop-connection';
import { db } from '@/shared/db';
import {
  audits,
  legalConsents,
  productChanges,
  products,
  projects,
  subscriptions,
  users
} from '@/shared/db/schema';
import { shopifyAppConfig, type ShopifyAppConfig } from '../lib/oauth';
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
): Promise<{ accessToken: string; scopes: string[] } | null> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token'
  });
  const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; scope?: string };
  if (!json.access_token) return null;
  return {
    accessToken: json.access_token,
    scopes: (json.scope ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
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
  const facts = await fetchShopFacts(auth.shop, token.accessToken, deps.makeClient);
  const row = await recordShopifyInstall(auth.shop, facts, token.accessToken);
  if (row.userId && row.projectId) {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, row.projectId), eq(projects.userId, row.userId))
    });
    if (project) {
      await attachShopToProject(row, row.userId, project.id, token.accessToken, auth.cfg, deps);
      return (await getShopifyShop(auth.shop))!;
    }
  }
  return row;
}

// ------------------------------------------------------------------ attach

async function attachShopToProject(
  row: ShopifyShopRow,
  userId: string,
  projectId: string,
  accessToken: string,
  cfg: ShopifyAppConfig,
  deps: EmbeddedDeps
): Promise<void> {
  const saved = await connectShopify({
    projectId,
    userId,
    shopDomain: row.shopDomain,
    accessToken,
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
async function projectFor(userId: string, row: ShopifyShopRow): Promise<string> {
  const domain = row.primaryDomain ?? row.shopDomain;
  for (const d of [row.primaryDomain, row.shopDomain]) {
    if (!d) continue;
    const found = await db.query.projects.findFirst({
      where: and(eq(projects.userId, userId), eq(projects.domain, d))
    });
    if (found) return found.id;
  }
  const id = randomUUID();
  await db.insert(projects).values({
    id,
    userId,
    name: row.shopName?.trim() || domain,
    domain,
    url: `https://${domain}`,
    source: 'shopify'
  });
  return id;
}

// ------------------------------------------------------------------ onboarding

export type OnboardResult =
  | { ok: true; userId: string; projectId: string }
  | { ok: false; reason: 'not_installed' | 'already_linked' | 'no_email' | 'email_taken' };

export async function emailTaken(email: string | null): Promise<boolean> {
  if (!email) return false;
  const u = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase().trim()) });
  return Boolean(u);
}

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
  const token = openPendingToken(row);
  if (!token) return { ok: false, reason: 'not_installed' };
  const email = row.shopEmail?.toLowerCase().trim() || null;
  if (!email) return { ok: false, reason: 'no_email' };
  if (await emailTaken(email)) return { ok: false, reason: 'email_taken' };

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    email,
    name: row.shopName?.trim() || null,
    plan: 'free',
    billingChannel: 'shopify',
    locale: opts.locale ?? null
  });
  await applyCreditTransaction({
    userId,
    delta: SIGNUP_FREE_CREDITS,
    bucket: 'pack',
    reason: 'signup_grant',
    idempotencyKey: `grant-signup-${userId}`
  });
  await db.insert(legalConsents).values({
    id: randomUUID(),
    userId,
    kind: 'signup_tos',
    version: LEGAL_TERMS_VERSION,
    source: `user:${userId}`,
    locale: opts.locale ?? null
  });
  const projectId = await projectFor(userId, row);
  await attachShopToProject(row, userId, projectId, token, cfg, opts);
  return { ok: true, userId, projectId };
}

// ------------------------------------------------------------------ linking an existing account

const LINK_TTL_MS = 15 * 60 * 1000;

function linkSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

/** Short-lived, signed invitation to attach this shop to whoever logs in. */
export function createShopLinkToken(shop: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ shop, exp: now + LINK_TTL_MS, n: randomBytes(8).toString('base64url') })
  ).toString('base64url');
  const mac = createHmac('sha256', linkSecret()).update(`shop-link.${payload}`).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyShopLinkToken(
  token: string | null | undefined,
  now: number = Date.now()
): string | null {
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(
    createHmac('sha256', linkSecret()).update(`shop-link.${payload}`).digest('base64url')
  );
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      shop?: string;
      exp?: number;
    };
    if (typeof p.shop !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
    return p.shop;
  } catch {
    return null;
  }
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
  const accessToken = openPendingToken(row);
  if (!accessToken) return { ok: false, reason: 'not_installed' };
  const projectId = await projectFor(userId, row);
  await attachShopToProject(row, userId, projectId, accessToken, cfg, opts);
  await adoptShopifyBilling(userId);
  return { ok: true, projectId, shopName: row.shopName };
}

/**
 * A linked account buys through Shopify from now on (App Store 1.2.1), except
 * a live Stripe plan, which keeps running on the web until it ends.
 */
async function adoptShopifyBilling(userId: string): Promise<void> {
  const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) });
  const liveStripe =
    !!sub && sub.channel === 'stripe' && sub.plan !== 'free' && sub.status !== 'canceled';
  if (liveStripe) return;
  await db.update(users).set({ billingChannel: 'shopify' }).where(eq(users.id, userId));
}

// ------------------------------------------------------------------ state for the embedded page

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return null;
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

export interface EmbeddedReadyState {
  kind: 'ready';
  shop: string;
  shopName: string | null;
  projectId: string;
  billingChannel: 'stripe' | 'shopify';
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
  const [user, project, connection] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, row.userId) }),
    db.query.projects.findFirst({ where: eq(projects.id, row.projectId) }),
    getConnection(row.projectId)
  ]);
  const sub = user
    ? await db.query.subscriptions.findFirst({ where: (s, { eq: e }) => e(s.userId, user.id) })
    : null;
  const [[productCount], [pending], latest] = await Promise.all([
    db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.projectId, row.projectId), eq(products.status, 'active'))),
    db
      .select({ n: count() })
      .from(productChanges)
      .where(
        and(eq(productChanges.projectId, row.projectId), eq(productChanges.status, 'pending'))
      ),
    db.query.audits.findFirst({
      where: and(
        eq(audits.projectId, row.projectId),
        eq(audits.status, 'completed'),
        isNotNull(audits.scores)
      ),
      orderBy: (a, { desc }) => [desc(a.createdAt)]
    })
  ]);
  const overall = (latest?.scores as { overall?: number } | null)?.overall;
  return {
    kind: 'ready',
    shop: row.shopDomain,
    shopName: row.shopName ?? project?.name ?? null,
    projectId: row.projectId,
    billingChannel: user?.billingChannel ?? 'stripe',
    plan: user?.plan ?? 'free',
    cycle: sub?.billingCycle ?? null,
    subscriptionStatus: sub?.status ?? null,
    currentPeriodEndIso: sub?.currentPeriodEnd?.toISOString() ?? null,
    credits: user?.creditsBalance ?? 0,
    products: productCount?.n ?? 0,
    lastPullAtIso: connection?.lastPullAt?.toISOString() ?? null,
    pulling: Boolean(connection?.pullRequestedAt) || connection?.pullProgress?.phase === 'running',
    score: typeof overall === 'number' ? overall : null,
    pendingChanges: pending?.n ?? 0,
    testCharges: row.partnerDevelopment
  };
}
