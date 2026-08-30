import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/shared/db';
import { audits } from '@/shared/db/schema';

/**
 * Audits run inside the web process via `void processAudit(...)` fired from
 * launchAuditForUser. If the web process is restarted (deploy, OOM, kill)
 * while a row is in `pending` or `running`, the in-flight promise is
 * killed and the row is orphaned — UI stays stuck on the "audit running"
 * spinner forever.
 *
 * This watchdog flips any pending/running audit older than the timeout
 * to `failed` with a clear `process_interrupted` error so the user can
 * relaunch from the site dashboard. Runs on every worker tick (cheap
 * indexed query on status + a date comparison).
 *
 * Tuned to 8 minutes: real audits over 50 products typically finish in
 * 1-3 min; the dynamic AI sub-audit on 3 latest products adds another
 * 30-60s. 8 min is a comfortable ceiling that catches actual hangs
 * without flapping legitimate slow runs.
 */
const STUCK_AFTER_MS = 8 * 60 * 1000;
const STUCK_STATUSES: Array<'pending' | 'running'> = ['pending', 'running'];

export async function runAuditWatchdog(): Promise<{ recovered: number }> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = await db.query.audits.findMany({
    where: and(isNotNull(audits.id), lt(audits.createdAt, cutoff))
  });
  // Drizzle doesn't have a great way to filter on enum-in-array in the
  // mysql dialect for nullable columns; do it in JS to keep the code
  // boring.
  const targets = stuck.filter((a) => STUCK_STATUSES.includes(a.status as 'pending' | 'running'));
  if (targets.length === 0) return { recovered: 0 };

  for (const a of targets) {
    await db
      .update(audits)
      .set({
        status: 'failed',
        error: 'process_interrupted',
        completedAt: new Date()
      })
      .where(and(eq(audits.id, a.id), sql`${audits.status} IN ('pending','running')`));
  }

  console.log(`[audit-watchdog] cutoff=${cutoff.toISOString()} recovered=${targets.length}`);
  return { recovered: targets.length };
}
