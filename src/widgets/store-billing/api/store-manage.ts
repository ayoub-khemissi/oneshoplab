import { shopifyBillingLink } from '@/features/shopify-connector';
import { wixBillingLink } from '@/features/wix-connector';
import type { EmbeddedHost } from '@/shared/embedded';

export type BillingStore = EmbeddedHost;

/**
 * Where an account billed by a store (Shopify, Wix) buys plans and packs —
 * the store's app, never Stripe — or null for web billing. Inside an admin
 * it is that admin's embedded home.
 */
export async function storeManageFor(
  userId: string,
  host: EmbeddedHost | null
): Promise<{ url: string; store: BillingStore } | null> {
  const shopify = await shopifyBillingLink(userId, host === 'shopify');
  if (shopify) return { url: shopify, store: 'shopify' };
  const wix = await wixBillingLink(userId, host === 'wix');
  return wix ? { url: wix, store: 'wix' } : null;
}
