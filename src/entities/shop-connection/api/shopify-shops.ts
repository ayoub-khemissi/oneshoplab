import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/shared/db';
import { shopifyShops } from '@/shared/db/schema';
import { openSecret, sealSecret } from '@/shared/lib';

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
  accessToken: string | null
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
      pendingTokenCiphertext: accessToken ? sealSecret(accessToken) : null
    });
  } else {
    await db
      .update(shopifyShops)
      .set({
        ...values,
        ...(accessToken ? { pendingTokenCiphertext: sealSecret(accessToken) } : {}),
        // A reinstall keeps the owner and project: the embedded app reconnects
        // them with the fresh token instead of asking the merchant again.
        ...(existing.uninstalledAt ? { installedAt: new Date() } : {})
      })
      .where(eq(shopifyShops.shopDomain, shopDomain));
  }
  return (await getShopifyShop(shopDomain))!;
}

export function openPendingToken(row: ShopifyShopRow): string | null {
  if (!row.pendingTokenCiphertext) return null;
  try {
    return openSecret(row.pendingTokenCiphertext);
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
