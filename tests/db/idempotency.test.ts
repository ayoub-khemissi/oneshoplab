import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { apiIdempotency } from '@/shared/db/schema';
import {
  getIdempotent,
  idempotencyStorageKey,
  putIdempotent,
  sweepIdempotency
} from '@/shared/api';

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE api_idempotency`);
});
afterAll(async () => {
  await db.$client.end();
});

describe('idempotency cache', () => {
  it('miss → put → hit with the stored status/body; mismatch on a different body', async () => {
    expect(await getIdempotent('key-1', 'idem-a', 'h1')).toEqual({ kind: 'miss' });
    await putIdempotent('key-1', 'idem-a', 'h1', 200, { inserted: 3 });
    expect(await getIdempotent('key-1', 'idem-a', 'h1')).toEqual({
      kind: 'hit',
      status: 200,
      response: { inserted: 3 }
    });
    expect(await getIdempotent('key-1', 'idem-a', 'h2')).toEqual({ kind: 'mismatch' });
    // Scoped per api key: another key with the same header is a miss.
    expect(await getIdempotent('key-2', 'idem-a', 'h1')).toEqual({ kind: 'miss' });
    expect(idempotencyStorageKey('key-1', 'idem-a')).toHaveLength(64);
  });

  it('first writer wins on a concurrent duplicate', async () => {
    await Promise.all([
      putIdempotent('k', 'i', 'h', 200, { n: 1 }),
      putIdempotent('k', 'i', 'h', 200, { n: 2 })
    ]);
    const res = await getIdempotent('k', 'i', 'h');
    expect(res.kind).toBe('hit');
    const [row] = await db.select().from(apiIdempotency);
    expect(res.kind === 'hit' && res.response).toEqual(row.responseJson);
  });

  it('sweep removes rows older than the cutoff only', async () => {
    await putIdempotent('k', 'old', 'h', 200, null);
    await putIdempotent('k', 'new', 'h', 200, null);
    await db
      .update(apiIdempotency)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000) })
      .where(sql`${apiIdempotency.key} = ${idempotencyStorageKey('k', 'old')}`);
    expect(await sweepIdempotency(new Date(Date.now() - 24 * 3600_000))).toBe(1);
    expect(await getIdempotent('k', 'old', 'h')).toEqual({ kind: 'miss' });
    expect((await getIdempotent('k', 'new', 'h')).kind).toBe('hit');
  });
});
