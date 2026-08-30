import type { apiKeys, ApiKeyPermission, projects } from '@/shared/db/schema';

/** Public row shape: the hash never leaves the entity. */
export type ApiKeyRow = Omit<typeof apiKeys.$inferSelect, 'keyHash'>;
export type ProjectRow = typeof projects.$inferSelect;

export type VerifyFailureReason = 'unauthorized' | 'key_revoked' | 'key_expired';

export type VerifyApiKeyResult =
  { ok: true; key: ApiKeyRow } | { ok: false; reason: VerifyFailureReason; keyId?: string };

export interface CreateApiKeyInput {
  projectId: string;
  userId: string;
  name: string;
  permissions?: ApiKeyPermission[];
  expiresAt?: Date | null;
  ip?: string | null;
}

export type CreatedApiKey = { key: ApiKeyRow; plaintext: string };

/** Mutations answer with a 404-style `not_found` for foreign ids — never throw. */
export type OwnedResult<T> =
  { ok: true; value: T } | { ok: false; reason: 'not_found' | 'not_active' };
