import { and, inArray, lt, sql } from 'drizzle-orm';
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
 * relaunch from the site dashboard. Runs on every worker tick, so it must
 * stay a cheap query: status + date in SQL, ids only.
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
  // Ids only, filtered in SQL: this runs every tick, and an audit row carries
  // its whole summary (tens of MB each) — loading every audit to filter in JS
  // pulled gigabytes per tick and pinned the worker at 300% CPU (2026-09-28).
  const targets = await db
    .select({ id: audits.id })
    .from(audits)
    .where(and(inArray(audits.status, STUCK_STATUSES), lt(audits.createdAt, cutoff)));
  if (targets.length === 0) return { recovered: 0 };

  await db
    .update(audits)
    .set({
      status: 'failed',
      error: 'process_interrupted',
      completedAt: new Date()
    })
    .where(
      and(
        inArray(
          audits.id,
          targets.map((a) => a.id)
        ),
        sql`${audits.status} IN ('pending','running')`
      )
    );

  console.log(`[audit-watchdog] cutoff=${cutoff.toISOString()} recovered=${targets.length}`);
  return { recovered: targets.length };
}
