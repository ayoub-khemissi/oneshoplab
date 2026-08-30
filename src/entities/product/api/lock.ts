import { sql } from 'drizzle-orm';
import { db } from '@/shared/db';

export const SYNC_LOCK_TIMEOUT_SEC = 5;

export class ProjectSyncLocked extends Error {
  constructor(public readonly projectId: string) {
    super(`project ${projectId}: another sync holds the lock`);
    this.name = 'ProjectSyncLocked';
  }
}

/**
 * Advisory lock `osl:sync:<projectId>` shared by every catalog writer (v1
 * plugin batches, the Shopify puller). GET_LOCK is per connection, so both
 * calls run inside one transaction (one pinned connection) while `fn`
 * itself uses the pool: the lock only serialises writers, it is not the
 * write txn.
 */
export async function withProjectSyncLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const name = `osl:sync:${projectId}`;
  return db.transaction(async (tx) => {
    const [rows] = await tx.execute(sql`SELECT GET_LOCK(${name}, ${SYNC_LOCK_TIMEOUT_SEC}) AS ok`);
    const ok = Array.isArray(rows) ? (rows[0] as { ok: number | null } | undefined)?.ok : null;
    if (ok !== 1) throw new ProjectSyncLocked(projectId);
    try {
      return await fn();
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${name})`);
    }
  });
}
