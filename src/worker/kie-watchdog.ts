import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { getKieClient, persistKieJobFailure, persistKieJobSuccess } from '@/lib/ai';
import { db } from '@/lib/db';
import { jobs, type JobKind } from '@/lib/db/schema';

// Time before we start polling kie directly when no webhook came in.
// 30s gives the webhook a brief head start; in dev (localhost callback
// unreachable) the watchdog is the only path.
const STUCK_THRESHOLD_MS = 30_000;

// Generic safety net for kinds where a long wait is acceptable
// (e.g. an audit batch). Image jobs use the much tighter limits below.
const GENERIC_TIMEOUT_MS = 24 * 60 * 60_000;

// Image edits are short (kie typically returns in 30-90s). Anything
// stuck longer is almost certainly never coming back, so we cut the
// loss quickly and refund the user — the alternative is a tile that
// shows "generating… 7700s" indefinitely and a credit balance the user
// can't recover without admin intervention.
const IMAGE_PENDING_TIMEOUT_MS = 5 * 60_000;
const IMAGE_RUNNING_TIMEOUT_MS = 8 * 60_000;

const IMAGE_KINDS: JobKind[] = ['kie_image_edit', 'kie_image_generate'];

/**
 * Runs every worker tick. Three concerns, each independent:
 *
 *   1. Image jobs in `pending` past IMAGE_PENDING_TIMEOUT_MS: createTask
 *      never wrote a kieTaskId — most likely the web process died
 *      between debiting credits and posting to kie, so the row is an
 *      orphan with no upstream task at all. Mark failed + refund.
 *
 *   2. Image jobs in `running` past IMAGE_RUNNING_TIMEOUT_MS: try one
 *      last poll to kie; if kie doesn't say "success", treat as a
 *      timeout. We keep the poll instead of a blind fail because kie
 *      occasionally takes ~6min and we'd rather salvage a real result
 *      than refund a successful generation.
 *
 *   3. Other kinds (audit, prompt-suggest, …) past the generic
 *      threshold: poll kie if a taskId exists, otherwise leave alone
 *      until the audit-watchdog handles them. >24h is the giveup line.
 */
export async function runKieWatchdog(): Promise<void> {
  const now = Date.now();

  await reconcilePendingImageJobs(now);
  await reconcileRunningImageJobs(now);
  await reconcileOtherStuckJobs(now);
}

// ---------------------------------------------------------------------------
// 1. Pending image jobs — kie task never started.
// ---------------------------------------------------------------------------

async function reconcilePendingImageJobs(now: number): Promise<void> {
  const cutoff = new Date(now - IMAGE_PENDING_TIMEOUT_MS);
  const orphans = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, 'pending'),
      inArray(jobs.kind, IMAGE_KINDS),
      isNull(jobs.kieTaskId),
      // createdAt is always set; startedAt is set in startImageOptim
      // before kie returns, so a pending job's age is best read from
      // createdAt. Fall back via OR to cover legacy rows.
      or(lt(jobs.createdAt, cutoff), lt(jobs.startedAt, cutoff))
    ),
    limit: 20
  });
  if (orphans.length === 0) return;

  console.log(`[kie-watchdog] reaping ${orphans.length} orphaned pending image job(s)`);
  for (const job of orphans) {
    try {
      await persistKieJobFailure(
        job.id,
        job.kind,
        'createTask never returned a taskId — likely a web restart killed the request before kie was reached',
        'kie_create_lost'
      );
    } catch (e) {
      console.error(`[kie-watchdog] failed to reap orphan ${job.id}`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Running image jobs — kie task started, but webhook is too late.
// ---------------------------------------------------------------------------

async function reconcileRunningImageJobs(now: number): Promise<void> {
  // Anything past STUCK_THRESHOLD gets a poll; past IMAGE_RUNNING_TIMEOUT
  // gets force-failed regardless of poll outcome (other than success).
  const pollCutoff = new Date(now - STUCK_THRESHOLD_MS);
  const failCutoff = new Date(now - IMAGE_RUNNING_TIMEOUT_MS);

  const stuck = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, 'running'),
      inArray(jobs.kind, IMAGE_KINDS),
      isNotNull(jobs.kieTaskId),
      lt(jobs.startedAt, pollCutoff)
    ),
    limit: 20
  });
  if (stuck.length === 0) return;

  let kie;
  try {
    kie = getKieClient();
  } catch (e) {
    console.error('[kie-watchdog] kie client unavailable, skipping image tick', e);
    return;
  }

  for (const job of stuck) {
    if (!job.kieTaskId) continue;
    const overTimeout = job.startedAt && job.startedAt < failCutoff;
    try {
      const info = await kie.getTask(job.kieTaskId);
      if (info.state === 'success') {
        await persistKieJobSuccess(job.id, job.kind, info.resultJson, {
          costTimeSeconds: info.costTime ?? null
        });
        continue;
      }
      if (info.state === 'fail') {
        await persistKieJobFailure(
          job.id,
          job.kind,
          info.failMsg ?? null,
          info.failCode ?? null
        );
        continue;
      }
      if (overTimeout) {
        // Still "running" / "queuing" / etc. according to kie, but well
        // past our budget. Refund and move on.
        await persistKieJobFailure(
          job.id,
          job.kind,
          `kie did not finish within ${Math.round(IMAGE_RUNNING_TIMEOUT_MS / 1000)}s`,
          'kie_timed_out'
        );
      }
      // Otherwise: still legitimately working — leave alone for the next tick.
    } catch (e) {
      console.error(`[kie-watchdog] error checking image task ${job.kieTaskId}:`, e);
      // If we can't even reach kie and the job is past the hard timeout,
      // give up rather than letting it linger forever.
      if (overTimeout) {
        try {
          await persistKieJobFailure(
            job.id,
            job.kind,
            `kie unreachable past ${Math.round(IMAGE_RUNNING_TIMEOUT_MS / 1000)}s budget`,
            'kie_timed_out'
          );
        } catch (e2) {
          console.error(`[kie-watchdog] giveup-fail also failed for ${job.id}`, e2);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Other kie kinds — keep the original lenient policy.
// ---------------------------------------------------------------------------

async function reconcileOtherStuckJobs(now: number): Promise<void> {
  const stuckCutoff = new Date(now - STUCK_THRESHOLD_MS);
  const timeoutCutoff = new Date(now - GENERIC_TIMEOUT_MS);

  const stuck = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, 'running'),
      isNotNull(jobs.kieTaskId),
      lt(jobs.startedAt, stuckCutoff)
    ),
    limit: 20
  });
  if (stuck.length === 0) return;

  // Drop the image kinds — they were handled above with tighter limits.
  const others = stuck.filter((j) => !(IMAGE_KINDS as string[]).includes(j.kind));
  if (others.length === 0) return;

  let kie;
  try {
    kie = getKieClient();
  } catch (e) {
    console.error('[kie-watchdog] kie client unavailable, skipping generic tick', e);
    return;
  }

  for (const job of others) {
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
    } catch (e) {
      console.error(`[kie-watchdog] error checking ${job.kieTaskId}:`, e);
    }
  }
}
