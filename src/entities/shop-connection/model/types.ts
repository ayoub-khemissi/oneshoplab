import type { shopConnections, ShopConnectionAuthMode, ShopPullProgress } from '@/shared/db/schema';

export type ShopConnectionRow = typeof shopConnections.$inferSelect;

/** What callers outside the entity see: never the ciphertext columns. */
export type ShopConnection = Omit<
  ShopConnectionRow,
  'accessTokenCiphertext' | 'webhookSecretCiphertext' | 'refreshTokenCiphertext'
> & {
  hasWebhookSecret: boolean;
};

export interface ConnectShopifyInput {
  projectId: string;
  userId: string;
  shopDomain: string;
  accessToken: string;
  /** Custom-app "API secret key" — optional; without it no webhooks. */
  apiSecret?: string | null;
  shopName?: string | null;
  scopes?: string[];
  apiVersion: string;
  /** Default `custom_app`; the OAuth callback passes `oauth`. */
  authMode?: ShopConnectionAuthMode;
}

export interface ConnectWixInput {
  projectId: string;
  userId: string;
  instanceId: string;
  refreshToken: string;
  /** Site hostname when known, else the instance id (shown on the card). */
  shopDomain: string;
  shopName?: string | null;
  scopes?: string[];
}

export type ConnectWixResult =
  | { ok: true; connection: ShopConnection }
  | { ok: false; reason: 'not_found' | 'invalid_token' | 'no_key' };

export interface DecryptedWixSecrets {
  instanceId: string;
  refreshToken: string;
}

export type ConnectShopifyResult =
  | { ok: true; connection: ShopConnection }
  | { ok: false; reason: 'not_found' | 'invalid_domain' | 'invalid_token' | 'no_key' };

export interface DecryptedSecrets {
  shopDomain: string;
  accessToken: string;
  webhookSecret: string | null;
  apiVersion: string;
}

export type { ShopPullProgress };
