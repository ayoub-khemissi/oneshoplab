import type { ShopConnection } from './types';

/** Serialisable, secret-free shape of a connection for client props / polling. */
export interface ShopifyConnectionView {
  status: ShopConnection['status'];
  platform: ShopConnection['platform'];
  authMode: ShopConnection['authMode'];
  shopDomain: string;
  shopName: string | null;
  lastPullAtIso: string | null;
  /** `total` is the catalog size known to OSL (null before the first pull). */
  pullProgress: { done: number; total: number | null; running: boolean; error?: string } | null;
  /** A pull was requested and the worker has not picked it up yet. */
  pullPending: boolean;
  lastWebhookAtIso: string | null;
  lastError: string | null;
  hasWebhookSecret: boolean;
}

export function toShopifyConnectionView(
  c: ShopConnection,
  productTotal: number | null = null
): ShopifyConnectionView {
  const p = c.pullProgress;
  return {
    status: c.status,
    platform: c.platform,
    authMode: c.authMode,
    shopDomain: c.shopDomain,
    shopName: c.shopName ?? null,
    lastPullAtIso: c.lastPullAt?.toISOString() ?? null,
    pullProgress: p
      ? {
          done: p.fetched,
          total: p.phase === 'done' ? p.fetched : productTotal,
          running: p.phase === 'running',
          ...(p.error ? { error: p.error } : {})
        }
      : null,
    pullPending: c.pullRequestedAt !== null && c.status === 'connected',
    lastWebhookAtIso: c.lastWebhookAt?.toISOString() ?? null,
    lastError: c.lastError ?? null,
    hasWebhookSecret: c.hasWebhookSecret
  };
}

/** Same secret-free shape for the Wix card (one connection row per project, either platform). */
export type WixConnectionView = ShopifyConnectionView;
export const toWixConnectionView: (
  c: ShopConnection,
  productTotal?: number | null
) => WixConnectionView = toShopifyConnectionView;
