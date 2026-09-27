import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/shared/db';
import { shopifyShops } from '@/shared/db/schema';
import { openSecret, sealSecret } from '@/shared/lib';
import type { ShopifyTokenGrant } from '../model/types';

export type ShopifyShopRow = typeof shopifyShops.$inferSelect;

export interface ShopifyShopFacts {
  shopName: string | null;
  shopEmail: string | null;
  primaryDomain: string | null;
  partnerDevelopment: boolean;
  scopes: string[];
}

export async function getShopifyShop(shopDomain: string): Promise<ShopifyShopRow | null> {
  const [row] = await db.select().from(shopifyShops).where(eq(shopifyShops.shopDomain, shopDomain));
  return row ?? null;
}

/**
 * Records an install seen from the embedded app. A fresh token replaces the
 * pending one only while the shop is unlinked; a reinstall clears
 * `uninstalledAt` (requirement 2.3.4: reinstalling authenticates again).
 */
export async function recordShopifyInstall(
  shopDomain: string,
  facts: ShopifyShopFacts,
  grant: ShopifyTokenGrant | null
): Promise<ShopifyShopRow> {
  const existing = await getShopifyShop(shopDomain);
  const values = {
    shopName: facts.shopName,
    shopEmail: facts.shopEmail?.toLowerCase().trim() || null,
    primaryDomain: facts.primaryDomain,
    partnerDevelopment: facts.partnerDevelopment,
    scopes: facts.scopes,
    uninstalledAt: null
  };
  if (!existing) {
    await db.insert(shopifyShops).values({
      shopDomain,
      ...values,
      pendingTokenCiphertext: grant ? sealGrant(grant) : null
    });
  } else {
    await db
      .update(shopifyShops)
      .set({
        ...values,
        ...(grant ? { pendingTokenCiphertext: sealGrant(grant) } : {}),
        // A reinstall keeps the owner and project: the embedded app reconnects
        // them with the fresh token instead of asking the merchant again.
        ...(existing.uninstalledAt ? { installedAt: new Date() } : {})
      })
      .where(eq(shopifyShops.shopDomain, shopDomain));
  }
  return (await getShopifyShop(shopDomain))!;
}

function sealGrant(g: ShopifyTokenGrant): string {
  return sealSecret(
    JSON.stringify({
      a: g.accessToken,
      r: g.refreshToken,
      e: g.expiresAt?.toISOString() ?? null,
      re: g.refreshExpiresAt?.toISOString() ?? null
    })
  );
}

/** The pending grant; a row sealed before expiring tokens holds the bare token. */
export function openPendingGrant(row: ShopifyShopRow): ShopifyTokenGrant | null {
  if (!row.pendingTokenCiphertext) return null;
  let raw: string;
  try {
    raw = openSecret(row.pendingTokenCiphertext);
  } catch {
    return null;
  }
  if (!raw.startsWith('{')) {
    return { accessToken: raw, refreshToken: null, expiresAt: null, refreshExpiresAt: null };
  }
  try {
    const j = JSON.parse(raw) as {
      a?: string;
      r?: string | null;
      e?: string | null;
      re?: string | null;
    };
    if (!j.a) return null;
    return {
      accessToken: j.a,
      refreshToken: j.r ?? null,
      expiresAt: j.e ? new Date(j.e) : null,
      refreshExpiresAt: j.re ? new Date(j.re) : null
    };
  } catch {
    return null;
  }
}

/** The shop now belongs to a project: `shop_connections` holds the token. */
export async function markShopifyShopLinked(
  shopDomain: string,
  userId: string,
  projectId: string
): Promise<void> {
  await db
    .update(shopifyShops)
    .set({ userId, projectId, linkedAt: new Date(), pendingTokenCiphertext: null })
    .where(eq(shopifyShops.shopDomain, shopDomain));
}

export async function markShopifyShopUninstalled(
  shopDomain: string
): Promise<ShopifyShopRow | null> {
  await db
    .update(shopifyShops)
    .set({ uninstalledAt: new Date(), pendingTokenCiphertext: null })
    .where(eq(shopifyShops.shopDomain, shopDomain));
  return getShopifyShop(shopDomain);
}

/** Shops where the app is currently installed and linked to this user. */
export async function installedShopifyShopsFor(userId: string): Promise<ShopifyShopRow[]> {
  return db
    .select()
    .from(shopifyShops)
    .where(and(eq(shopifyShops.userId, userId), isNull(shopifyShops.uninstalledAt)));
}

/** GDPR shop/redact: nothing about the shop is kept. */
export async function deleteShopifyShop(shopDomain: string): Promise<void> {
  await db.delete(shopifyShops).where(eq(shopifyShops.shopDomain, shopDomain));
}
