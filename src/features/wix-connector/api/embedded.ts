/**
 * The app as Wix runs it: a dashboard page (iframe) in the site's Wix
 * dashboard. Wix gives that page a signed `instance` in its URL and nothing
 * else — no cookie of ours in the frame, no App Bridge. Everything starts
 * from that instance:
 *
 *   signed instance ─▶ our session token (Bearer on every later request)
 *                   ─▶ wix_instances row (site facts from Get App Instance)
 *                   ─▶ new OneShopLab account     (onboardWixSite)
 *                   ─▶ or an existing one         (link token → linkWixSiteToUser)
 *                   ─▶ project + Wix connection   (same as the website install)
 *
 * The website's own "connect my store" (oauth.ts) lands in the same registry.
 */
import {
  connectWix,
  createAccountFromStore,
  createStoreLinkToken,
  emailTaken,
  getConnection,
  getWixInstance,
  loadStoreSummary,
  markWixInstanceLinked,
  maskEmail,
  projectForStore,
  recordWixInstall,
  requestPull,
  settleBillingChannel,
  signWixSessionToken,
  verifyStoreLinkToken,
  verifyWixSessionToken,
  type WixInstanceRow
} from '@/entities/shop-connection';
import { and, eq } from 'drizzle-orm';
import { APP_STORE_TEST_CREDIT_CAP } from '@/entities/ai-model';
import { db } from '@/shared/db';
import { projects, subscriptions } from '@/shared/db/schema';
import { wixAppConfig, type WixAppConfig } from '../lib/config';
import { verifySignedInstance } from '../lib/signed-instance';
import { getAppInstance, sendSetupFinished, type WixAppInstance } from './app-management';
import { syncWixBilling, type WixBillingDeps } from './app-billing';
import { createWixClient } from './client';

export const WIX_SCOPES = ['WIX_STORES.MANAGE_PRODUCTS'];
/** A dashboard `instance` older than this is not accepted as a fresh sign-in. */
const INSTANCE_MAX_AGE_MS = 60 * 60 * 1000;

export type WixEmbeddedDeps = WixBillingDeps;

// ------------------------------------------------------------------ session

/**
 * The dashboard page's first load: Wix's signed `instance` becomes our
 * session token. Stale instances are refused, so one found in a log or a
 * browser history cannot open a session later.
 */
export function wixSessionFromInstance(
  signedInstance: string | null | undefined,
  now: number = Date.now()
): { instanceId: string; token: string } | null {
  const cfg = wixAppConfig();
  if (!cfg) return null;
  const inst = verifySignedInstance(signedInstance, cfg.appSecret);
  if (!inst) return null;
  const signedAt = inst.signDate ? Date.parse(inst.signDate) : NaN;
  if (!Number.isFinite(signedAt) || now - signedAt > INSTANCE_MAX_AGE_MS) return null;
  return {
    instanceId: inst.instanceId,
    token: signWixSessionToken(inst.instanceId, cfg.appSecret, Math.floor(now / 1000))
  };
}

export type WixEmbeddedAuth =
  | { ok: true; instanceId: string; cfg: WixAppConfig }
  | { ok: false; status: 401 | 503; error: 'not_configured' | 'unauthorized' };

/** Every call of the dashboard page carries our session token as Bearer. */
export function authenticateWixEmbedded(bearer: string | null | undefined): WixEmbeddedAuth {
  const cfg = wixAppConfig();
  if (!cfg) return { ok: false, status: 503, error: 'not_configured' };
  const claims = verifyWixSessionToken(bearer, cfg.appSecret);
  if (!claims) return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true, instanceId: claims.instanceId, cfg };
}

/** A fresh token for the same site, before the current one expires. */
export function renewWixSession(instanceId: string): string | null {
  const cfg = wixAppConfig();
  return cfg ? signWixSessionToken(instanceId, cfg.appSecret) : null;
}

// ------------------------------------------------------------------ install

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function connectionUsable(projectId: string | null): Promise<boolean> {
  if (!projectId) return false;
  const c = await getConnection(projectId);
  return Boolean(c && c.platform === 'wix' && c.status === 'connected');
}

function projectFor(userId: string, row: WixInstanceRow): Promise<string> {
  return projectForStore(userId, {
    domains: [row.siteHost],
    name: row.siteName,
    source: 'wix'
  });
}

/**
 * The site becomes one of the user's sites: Wix connection, first pull,
 * billing through Wix from now on (unless a paid plan still runs elsewhere),
 * and Wix is told the setup is done.
 */
export async function attachWixSite(
  row: WixInstanceRow,
  userId: string,
  projectId: string,
  deps: WixEmbeddedDeps = {}
): Promise<void> {
  const saved = await connectWix({
    projectId,
    userId,
    instanceId: row.instanceId,
    shopDomain: row.siteHost ?? row.instanceId,
    shopName: row.siteName,
    scopes: WIX_SCOPES
  });
  if (!saved.ok) throw new Error(`connectWix: ${saved.reason}`);
  await requestPull(projectId);
  await markWixInstanceLinked(row.instanceId, userId, projectId);
  await settleBillingChannel(userId, 'wix');
  const cfg = wixAppConfig();
  if (cfg) {
    try {
      await sendSetupFinished(
        (deps.makeClient ?? createWixClient)({
          appId: cfg.appId,
          appSecret: cfg.appSecret,
          instanceId: row.instanceId
        })
      );
    } catch {
      // Analytics only: never fail a link on it.
    }
  }
}

export interface WixInstall {
  row: WixInstanceRow;
  /** Fresh from Wix when the site had to be (re)registered; null otherwise. */
  instance: WixAppInstance | null;
}

/**
 * Makes sure the site is registered and, once it belongs to an account,
 * connected. A linked, connected site is a single row read; otherwise Wix is
 * asked for the site facts (owner email, name, host, Wix Stores), and a
 * reinstalled site is reconnected to its account right away.
 */
export async function ensureWixInstall(
  instanceId: string,
  deps: WixEmbeddedDeps = {}
): Promise<WixInstall> {
  const existing = await getWixInstance(instanceId);
  if (existing && !existing.uninstalledAt && (await connectionUsable(existing.projectId))) {
    return { row: existing, instance: null };
  }
  const cfg = wixAppConfig();
  if (!cfg) throw new Error('Wix app not configured');
  const client = (deps.makeClient ?? createWixClient)({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    instanceId
  });
  const instance = await getAppInstance(client);
  if (!instance) throw new Error('Wix does not know this app instance');
  const row = await recordWixInstall(instanceId, {
    siteName: instance.site.siteDisplayName,
    siteHost: hostOf(instance.site.url),
    ownerEmail: instance.site.ownerEmail,
    siteLocale: instance.site.locale
  });
  if (row.userId) {
    const projectId = (await ownedProject(row)) ?? (await projectFor(row.userId, row));
    await attachWixSite(row, row.userId, projectId, deps);
    return { row: (await getWixInstance(instanceId))!, instance };
  }
  return { row, instance };
}

/** The row's project while it still belongs to the row's user (it may have been deleted). */
async function ownedProject(row: WixInstanceRow): Promise<string | null> {
  if (!row.projectId || !row.userId) return null;
  const found = await db.query.projects.findFirst({
    where: and(eq(projects.id, row.projectId), eq(projects.userId, row.userId))
  });
  return found?.id ?? null;
}

// ------------------------------------------------------------------ onboarding and linking

export type WixOnboardResult =
  | { ok: true; userId: string; projectId: string }
  | { ok: false; reason: 'not_installed' | 'already_linked' | 'no_email' | 'email_taken' };

/** "Create my workspace": a new account from the site owner's Wix email. */
export async function onboardWixSite(
  instanceId: string,
  opts: { locale?: string | null } & WixEmbeddedDeps = {}
): Promise<WixOnboardResult> {
  const row = await getWixInstance(instanceId);
  if (!row || row.uninstalledAt) return { ok: false, reason: 'not_installed' };
  if (row.userId && row.projectId) return { ok: false, reason: 'already_linked' };
  const email = row.ownerEmail?.toLowerCase().trim() || null;
  if (!email) return { ok: false, reason: 'no_email' };
  if (await emailTaken(email)) return { ok: false, reason: 'email_taken' };
  const userId = await createAccountFromStore({
    email,
    name: row.siteName,
    locale: opts.locale ?? row.siteLocale ?? null,
    billingChannel: 'wix'
  });
  const projectId = await projectFor(userId, row);
  await attachWixSite(row, userId, projectId, opts);
  return { ok: true, userId, projectId };
}

export function createWixLinkToken(instanceId: string, now: number = Date.now()): string {
  return createStoreLinkToken('wix', instanceId, now);
}

export function verifyWixLinkToken(
  token: string | null | undefined,
  now: number = Date.now()
): string | null {
  return verifyStoreLinkToken('wix', token, now);
}

export type WixLinkResult =
  | { ok: true; projectId: string; siteName: string | null }
  | { ok: false; reason: 'bad_token' | 'not_installed' | 'linked_elsewhere' };

/** The logged-in user confirmed on the website: this Wix site becomes one of their sites. */
export async function linkWixSiteToUser(
  token: string,
  userId: string,
  deps: WixEmbeddedDeps = {}
): Promise<WixLinkResult> {
  const instanceId = verifyWixLinkToken(token);
  if (!instanceId) return { ok: false, reason: 'bad_token' };
  const row = await getWixInstance(instanceId);
  if (!row || row.uninstalledAt) return { ok: false, reason: 'not_installed' };
  if (row.userId && row.userId !== userId && row.projectId)
    return { ok: false, reason: 'linked_elsewhere' };
  if (row.userId === userId && row.projectId && (await connectionUsable(row.projectId))) {
    return { ok: true, projectId: row.projectId, siteName: row.siteName };
  }
  const projectId = await projectFor(userId, row);
  await attachWixSite(row, userId, projectId, deps);
  return { ok: true, projectId, siteName: row.siteName };
}

// ------------------------------------------------------------------ state for the dashboard page

export type WixEmbeddedState =
  | {
      kind: 'onboarding';
      shop: string;
      shopName: string | null;
      email: string | null;
      emailTaken: boolean;
      /** Wix Stores is missing from the site: there is no catalog to work on. */
      storesMissing: boolean;
    }
  | {
      kind: 'ready';
      shop: string;
      shopName: string | null;
      projectId: string;
      billingChannel: 'stripe' | 'shopify' | 'wix';
      plan: string;
      cycle: string | null;
      subscriptionStatus: string | null;
      /** The plan runs on another Wix site of the account (billing is per site on Wix). */
      planOnOtherSite: boolean;
      currentPeriodEndIso: string | null;
      credits: number;
      products: number;
      lastPullAtIso: string | null;
      pulling: boolean;
      score: number | null;
      pendingChanges: number;
      testCharges: boolean;
      testCreditCap: number;
    };

function storesMissing(instance: WixAppInstance | null): boolean {
  if (!instance || instance.site.installedWixApps.length === 0) return false;
  return !instance.site.installedWixApps.some((a) => /stores/i.test(a));
}

export async function loadWixEmbeddedState(
  install: WixInstall,
  deps: WixEmbeddedDeps = {}
): Promise<WixEmbeddedState> {
  const { row, instance } = install;
  if (!row.userId || !row.projectId) {
    return {
      kind: 'onboarding',
      shop: row.instanceId,
      shopName: row.siteName,
      email: maskEmail(row.ownerEmail),
      emailTaken: await emailTaken(row.ownerEmail),
      storesMissing: storesMissing(instance)
    };
  }
  // Returning from a Wix checkout lands here: read what Wix says first.
  try {
    await syncWixBilling(row.instanceId, deps);
  } catch (e) {
    console.error('[wix billing] sync', row.instanceId, e instanceof Error ? e.message : e);
  }
  const summary = await loadStoreSummary(row.userId, row.projectId);
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, row.userId)
  });
  return {
    kind: 'ready',
    shop: row.instanceId,
    shopName: row.siteName ?? summary.projectName,
    projectId: row.projectId,
    billingChannel: summary.billingChannel,
    plan: summary.plan,
    cycle: summary.cycle,
    subscriptionStatus: summary.subscriptionStatus,
    planOnOtherSite: Boolean(
      sub?.channel === 'wix' &&
      sub.plan !== 'free' &&
      sub.wixInstanceId &&
      sub.wixInstanceId !== row.instanceId
    ),
    currentPeriodEndIso: summary.currentPeriodEndIso,
    credits: summary.credits,
    products: summary.products,
    lastPullAtIso: summary.lastPullAtIso,
    pulling: summary.pulling,
    score: summary.score,
    pendingChanges: summary.pendingChanges,
    testCharges: !wixAppConfig()?.published,
    testCreditCap: APP_STORE_TEST_CREDIT_CAP
  };
}
