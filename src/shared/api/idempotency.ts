/**
 * `Idempotency-Key` cache for write endpoints. Keyed by sha256(apiKeyId +
 * ':' + header) so a key rotation naturally starts a fresh namespace and a
 * header value can never collide across keys. Rows live 24 h (the worker
 * sweeps them hourly).
 */
import { createHash } from 'node:crypto';
import { eq, lt, sql } from 'drizzle-orm';
import { db } from '@/shared/db';
import { apiIdempotency } from '@/shared/db/schema';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export function idempotencyStorageKey(apiKeyId: string, header: string): string {
  return createHash('sha256').update(`${apiKeyId}:${header}`).digest('hex');
}

export type IdempotencyLookup =
  { kind: 'miss' } | { kind: 'hit'; status: number; response: unknown } | { kind: 'mismatch' };

export async function getIdempotent(
  apiKeyId: string,
  header: string,
  bodyHash: string
): Promise<IdempotencyLookup> {
  const [row] = await db
    .select()
    .from(apiIdempotency)
    .where(eq(apiIdempotency.key, idempotencyStorageKey(apiKeyId, header)));
  if (!row) return { kind: 'miss' };
  if (row.bodyHash !== bodyHash) return { kind: 'mismatch' };
  return { kind: 'hit', status: row.status, response: row.responseJson };
}

/** First writer wins: a concurrent duplicate keeps the stored response. */
export async function putIdempotent(
  apiKeyId: string,
  header: string,
  bodyHash: string,
  status: number,
  response: unknown
): Promise<void> {
  await db
    .insert(apiIdempotency)
    .values({
      key: idempotencyStorageKey(apiKeyId, header),
      bodyHash,
      status,
      responseJson: response ?? null
    })
    .onDuplicateKeyUpdate({ set: { key: sql`${apiIdempotency.key}` } });
}

export async function sweepIdempotency(olderThan: Date): Promise<number> {
  const [res] = await db.delete(apiIdempotency).where(lt(apiIdempotency.createdAt, olderThan));
  return res.affectedRows;
}
