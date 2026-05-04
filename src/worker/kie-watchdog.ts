import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { getKieClient, persistKieJobFailure, persistKieJobSuccess } from '@/lib/ai';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';

// 30s gives the webhook a brief head start, then we start polling kie
// directly. In production with a public APP_URL the webhook usually wins;
// in dev (localhost callback unreachable) the watchdog is the only path.
const STUCK_THRESHOLD_MS = 30_000;
const TIMEOUT_THRESHOLD_MS = 24 * 60 * 60_000;

/**
 * Reconcile kie.ai jobs that have been `running` for too long without a
 * webhook callback. Two policies:
 *   - Stuck > 5min: poll kie directly to learn the current state.
 *   - Stuck > 24h: give up and mark `timed_out`.
 *
 * Webhook + watchdog work together: webhook is fast-path, watchdog is
 * the safety net for missed deliveries. Both call into the same shared
 * persistKieJobSuccess/Failure helpers (R2 download + credit refund).
 */
export async function runKieWatchdog(): Promise<void> {
  const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const timeoutCutoff = new Date(Date.now() - TIMEOUT_THRESHOLD_MS);

  const stuck = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, 'running'),
      isNotNull(jobs.kieTaskId),
      lt(jobs.startedAt, stuckCutoff)
    ),
    limit: 20
  });
  if (stuck.length === 0) return;

  console.log(`[kie-watchdog] reconciling ${stuck.length} stuck job(s)`);

  let kie;
  try {
    kie = getKieClient();
  } catch (e) {
    console.error('[kie-watchdog] kie client unavailable, skipping tick', e);
    return;
  }

  for (const job of stuck) {
    if (!job.kieTaskId) continue;
    try {
      if (job.startedAt && job.startedAt < timeoutCutoff) {
        await persistKieJobFailure(job.id, job.kind, 'No webhook within 24h', null);
        continue;
      }

      const info = await kie.getTask(job.kieTaskId);

      if (info.state === 'success') {
        await persistKieJobSuccess(job.id, job.kind, info.resultJson, {
          costTimeSeconds: info.costTime ?? null
        });
      } else if (info.state === 'fail') {
        await persistKieJobFailure(
          job.id,
          job.kind,
          info.failMsg ?? null,
          info.failCode ?? null
        );
      }
      // Other states: still working — leave as-is for the next tick.
    } catch (e) {
      console.error(`[kie-watchdog] error checking ${job.kieTaskId}:`, e);
    }
  }
}
