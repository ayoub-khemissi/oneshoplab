import type { shopConnections, ShopPullProgress } from '@/shared/db/schema';

export type ShopConnectionRow = typeof shopConnections.$inferSelect;

/** What callers outside the entity see: never the ciphertext columns. */
export type ShopConnection = Omit<
  ShopConnectionRow,
  'accessTokenCiphertext' | 'webhookSecretCiphertext'
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
