import { and, isNull, lt, lte, or } from 'drizzle-orm';
import { IDEMPOTENCY_TTL_MS, sweepIdempotency } from '@/shared/api';
import { db } from '@/shared/db';
import { catalogSyncSessions } from '@/shared/db/schema';
import { expireDueChanges } from './changes';

const CLOSED_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Drop open sessions past their TTL (nothing archived) + old closed ones. */
export async function sweepSyncSessions(now: Date = new Date()): Promise<number> {
  const [res] = await db
    .delete(catalogSyncSessions)
    .where(
      or(
        and(isNull(catalogSyncSessions.closedAt), lte(catalogSyncSessions.expiresAt, now)),
        lt(catalogSyncSessions.closedAt, new Date(now.getTime() - CLOSED_SESSION_RETENTION_MS))
      )
    );
  return res.affectedRows;
}

/** Hourly worker sweep (wired in src/worker/index.mts). */
export async function runIntegrationSweeps(now: Date = new Date()): Promise<{
  expiredChanges: number;
  idempotency: number;
  sessions: number;
}> {
  const expiredChanges = await expireDueChanges(now);
  const idempotency = await sweepIdempotency(new Date(now.getTime() - IDEMPOTENCY_TTL_MS));
  const sessions = await sweepSyncSessions(now);
  if (expiredChanges || idempotency || sessions) {
    console.info(
      `[product-change] sweep: expired=${expiredChanges} idempotency=${idempotency} sessions=${sessions}`
    );
  }
  return { expiredChanges, idempotency, sessions };
}
