import type { ShopifyConnectionView, WixConnectionView } from '@/entities/shop-connection/client';
import type { IntegrationInterest } from '@/shared/db/schema';

/** Platforms the wizard knows how to guide (manual/unknown have no plugin). */
export const INTEGRATION_PLATFORMS = ['shopify', 'woocommerce', 'wix'] as const;
export type IntegrationPlatform = (typeof INTEGRATION_PLATFORMS)[number];

export type SiteKeyState = 'active' | 'grace' | 'revoked' | 'expired';

/** Serialisable view of an api key (dates as ISO strings for client props). */
export interface SiteKeySummary {
  id: string;
  name: string;
  prefix: string;
  state: SiteKeyState;
  createdAtIso: string;
  lastUsedAtIso: string | null;
  expiresAtIso: string | null;
  graceUntilIso: string | null;
  revokedAtIso: string | null;
}

export interface ConnectionStatus {
  hasActiveKey: boolean;
  lastUsedAtIso: string | null;
  productCount: number;
  /** Shopify branch: the project's connection row (null when none or another platform). */
  shopify: ShopifyConnectionView | null;
  /** Wix branch: same row when `platform = 'wix'`. */
  wix: WixConnectionView | null;
}

export type IntegrationInterestMap = IntegrationInterest;

export type KeyActionResult =
  | { ok: true; key: SiteKeySummary; plaintext: string }
  | { ok: false; error: 'unauthorized' | 'bad_request' | 'not_found' | 'not_active' };
