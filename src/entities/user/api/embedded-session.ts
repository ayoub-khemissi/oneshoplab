import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import type { Session } from 'next-auth';
import { cache } from 'react';
import {
  getShopifyShop,
  shopifyAppCredentials,
  verifyShopifyIdToken
} from '@/entities/shop-connection';
import { db } from '@/shared/db';
import { users } from '@/shared/db/schema';
import { embeddedRequestInfo } from '@/shared/embedded';

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
  return { user: sessionUser(user), expires: new Date(claims.exp * 1000).toISOString() };
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
  return bearer ? sessionFromShopifyIdToken(bearer) : null;
});
