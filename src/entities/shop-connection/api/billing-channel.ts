import { eq } from 'drizzle-orm';
import { installedShopifyShopsFor } from './shopify-shops';
import { installedWixInstancesFor } from './wix-instances';
import { db } from '@/shared/db';
import { subscriptions, users, type BillingChannel } from '@/shared/db/schema';

export type StoreBillingChannel = Exclude<BillingChannel, 'stripe'>;

/**
 * Who bills an account. A merchant who installed OneShopLab from a store's
 * app market pays through that store (Shopify App Store 1.2.1, Wix App
 * Market "Accepting payments"), so the account follows its installs:
 *
 * - a paid plan still running keeps its channel until it ends — Stripe on
 *   the web, or a store whose app is still installed;
 * - otherwise the store just installed (`prefer`) wins, then the current
 *   store if still installed, then any installed store;
 * - no store installed any more: back to Stripe.
 *
 * Called on every link and every uninstall.
 */
export async function settleBillingChannel(
  userId: string,
  prefer?: StoreBillingChannel
): Promise<BillingChannel> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return 'stripe';
  const [shops, wixSites, sub] = await Promise.all([
    installedShopifyShopsFor(userId),
    installedWixInstancesFor(userId),
    db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) })
  ]);
  const installed: StoreBillingChannel[] = [
    ...(shops.length ? (['shopify'] as const) : []),
    ...(wixSites.length ? (['wix'] as const) : [])
  ];
  const paidRunning = !!sub && sub.plan !== 'free' && sub.status !== 'canceled';
  let channel: BillingChannel;
  if (paidRunning && sub.channel === 'stripe') channel = 'stripe';
  else if (paidRunning && sub.channel !== 'stripe' && installed.includes(sub.channel))
    channel = sub.channel;
  else if (prefer && installed.includes(prefer)) channel = prefer;
  else if (user.billingChannel !== 'stripe' && installed.includes(user.billingChannel))
    channel = user.billingChannel;
  else channel = installed[0] ?? 'stripe';
  if (channel !== user.billingChannel) {
    await db.update(users).set({ billingChannel: channel }).where(eq(users.id, userId));
  }
  return channel;
}
