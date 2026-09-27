import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import type { Session } from 'next-auth';
import { cache } from 'react';
import {
  getShopifyShop,
  getWixInstance,
  isWixSessionToken,
  shopifyAppCredentials,
  verifyShopifyIdToken,
  verifyWixSessionToken,
  wixAppSecret
} from '@/entities/shop-connection';
import { db } from '@/shared/db';
import { users } from '@/shared/db/schema';
import { embeddedHomePath, embeddedRequestInfo } from '@/shared/embedded';

type UserRow = typeof users.$inferSelect;

/** The session fields every page reads, from the user row (cookie and embedded alike). */
export function sessionUser(u: UserRow): Session['user'] {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    plan: u.plan,
    creditsBalance: u.creditsBalance,
    preferredChatModel: u.preferredChatModel,
    preferredImageQuality: u.preferredImageQuality,
    preferredImageFormat: u.preferredImageFormat
  };
}

/**
 * Inside the Shopify admin the ID token is the session: it names the shop, and
 * the shop is linked to the OneShopLab account that installed it. No link (or
 * an uninstalled app) means no session — the embedded home offers the link.
 */
export async function sessionFromShopifyIdToken(
  token: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<Session | null> {
  const creds = shopifyAppCredentials();
  if (!creds) return null;
  const claims = verifyShopifyIdToken(token, creds, now);
  if (!claims) return null;
  const shop = await getShopifyShop(claims.shop);
  if (!shop?.userId || shop.uninstalledAt) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, shop.userId) });
  if (!user) return null;
  return {
    user: sessionUser(user),
    expires: new Date(claims.exp * 1000).toISOString(),
    embedded: { host: 'shopify', shop: shop.shopDomain, projectId: shop.projectId ?? null }
  };
}

/**
 * Inside the Wix dashboard our own session token (minted from the signed
 * `instance` Wix gives the dashboard page) names the site, and the site is
 * linked to the account that installed it. Same rules as Shopify.
 */
export async function sessionFromWixToken(
  token: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<Session | null> {
  const secret = wixAppSecret();
  if (!secret) return null;
  const claims = verifyWixSessionToken(token, secret, now);
  if (!claims) return null;
  const instance = await getWixInstance(claims.instanceId);
  if (!instance?.userId || instance.uninstalledAt) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, instance.userId) });
  if (!user) return null;
  return {
    user: sessionUser(user),
    expires: new Date(claims.exp * 1000).toISOString(),
    embedded: { host: 'wix', shop: instance.instanceId, projectId: instance.projectId ?? null }
  };
}

/** A Bearer token from inside an admin: Shopify's ID token or our Wix token. */
export function sessionFromEmbeddedToken(token: string): Promise<Session | null> {
  return isWixSessionToken(token) ? sessionFromWixToken(token) : sessionFromShopifyIdToken(token);
}

/** Once per request: layouts, pages and components all call `auth()`. */
export const embeddedSession = cache(async (): Promise<Session | null> => {
  let authorization: string | null;
  try {
    authorization = (await headers()).get('authorization');
  } catch {
    return null; // outside a request (worker, scripts)
  }
  const { bearer } = embeddedRequestInfo({ secFetchDest: null, authorization, idTokenParam: null });
  return bearer ? sessionFromEmbeddedToken(bearer) : null;
});

/**
 * Inside a store admin the app reaches only the store's own site: the
 * owner may have linked other stores (other businesses, other platforms),
 * and the shop's staff must not see or act on them. Pages redirect;
 * actions and API routes refuse with their usual "not found".
 */
export async function outsideEmbeddedScope(projectId: string | null | undefined): Promise<boolean> {
  const session = await embeddedSession();
  if (!session?.embedded) return false;
  return !projectId || projectId !== session.embedded.projectId;
}

/** The shop's site inside the admin (undefined outside it, null before linking). */
export async function embeddedProjectId(): Promise<string | null | undefined> {
  const session = await embeddedSession();
  return session?.embedded ? session.embedded.projectId : undefined;
}

/**
 * Page guard inside the admin: any page but the shop's own site (the sites
 * list, another site, "add a site", admin) goes to that site — or to the
 * embedded home while the shop is not linked yet. A no-op everywhere else.
 */
export async function enforceEmbeddedScope(siteId?: string): Promise<void> {
  const session = await embeddedSession();
  if (!session?.embedded) return;
  const { projectId, host } = session.embedded;
  if (projectId && siteId === projectId) return;
  redirect(
    projectId ? `/${await getLocale()}/dashboard/sites/${projectId}` : embeddedHomePath(host)
  );
}

/** Same rule, when the caller already holds the session (API routes). */
export function sessionOutsideScope(session: Session | null, projectId: string): boolean {
  return Boolean(session?.embedded && session.embedded.projectId !== projectId);
}
