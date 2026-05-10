import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import {
  getImageModel,
  getKieClient,
  persistKieJobFailure,
  persistKieJobSuccess,
  type ImageQualityId
} from '@/lib/ai';
import { buildKieCallbackUrl, type KieClient } from '@/lib/ai/kie';
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

// When the orphan first becomes eligible for a retry. 30s is well past
// kie's normal createTask round-trip (~1-3s), so a row sitting at
// pending+no-taskId past this window means the original web request
// died (typical cause: a pm2 reload mid-deploy). We try ONE recreate
// before giving up — at the cost of, in the rare race where the
// original call did reach kie before being killed, paying for one
// duplicate kie task whose webhook we'll then drop on the floor.
const IMAGE_PENDING_RETRY_AFTER_MS = 30_000;

const IMAGE_KINDS: JobKind[] = ['kie_image_edit', 'kie_image_generate'];

/**
 * Runs every worker tick. Three concerns, each independent:
 *
 *   1. Image jobs in `pending` with no kieTaskId: at IMAGE_PENDING_RETRY_AFTER
 *      we try ONE recreate against kie (resilient to pm2 reload that killed
 *      the original web request mid-fetch); past IMAGE_PENDING_TIMEOUT we
 *      give up and refund the user.
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
  const retryCutoff = new Date(now - IMAGE_PENDING_RETRY_AFTER_MS);
  const giveupCutoff = new Date(now - IMAGE_PENDING_TIMEOUT_MS);

  const orphans = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, 'pending'),
      inArray(jobs.kind, IMAGE_KINDS),
      isNull(jobs.kieTaskId),
      // Aged past the retry-eligibility window. createdAt is always set;
      // startedAt is set in startImageOptim BEFORE kie returns so it's
      // an equally valid age signal — we OR them for legacy rows.
      or(lt(jobs.createdAt, retryCutoff), lt(jobs.startedAt, retryCutoff))
    ),
    limit: 20
  });
  if (orphans.length === 0) return;

  let kie: KieClient | null = null;
  try {
    kie = getKieClient();
  } catch (e) {
    console.error('[kie-watchdog] kie client unavailable, skipping orphan retry tick', e);
  }

  for (const job of orphans) {
    const ageRef = job.createdAt < (job.startedAt ?? job.createdAt) ? job.createdAt : (job.startedAt ?? job.createdAt);
    const pastGiveup = ageRef < giveupCutoff;

    if (pastGiveup) {
      try {
        await persistKieJobFailure(
          job.id,
          job.kind,
          'createTask never returned a taskId — gave up after retry window expired',
          'kie_create_lost'
        );
      } catch (e) {
        console.error(`[kie-watchdog] failed to reap orphan ${job.id}`, e);
      }
      continue;
    }

    // Already retried once: leave it for the giveup branch above.
    if ((job.attempts ?? 0) > 0) continue;

    // Try to (re)create the kie task from the cached inputPayload. No
    // kie client = bail until next tick.
    if (!kie) continue;
    try {
      await retryCreateImagePending(kie, job);
    } catch (e) {
      console.error(`[kie-watchdog] orphan retry threw for ${job.id}`, e);
    }
  }
}

/**
 * One-shot retry of `kie.createTask` for an image job whose original web
 * request died before recording the kieTaskId (typical cause: pm2
 * reload mid-fetch). Reads the prompt + source URL from the cached
 * `inputPayload`, bumps `attempts` BEFORE the network call so a hung
 * retry doesn't get retried by the next tick, and on success flips the
 * row to `running` — letting the existing running-job watchdog take
 * over. Failure to reach kie is left as `pending` so the giveup branch
 * eventually refunds the user.
 */
async function retryCreateImagePending(
  kie: KieClient,
  job: typeof jobs.$inferSelect
): Promise<void> {
  const payload = job.inputPayload as
    | {
        userPrompt?: string;
        sourceImageUrl?: string;
        imageQualityId?: string;
      }
    | null;

  if (!payload?.userPrompt || !payload?.sourceImageUrl || !payload?.imageQualityId) {
    await persistKieJobFailure(
      job.id,
      job.kind,
      'createTask retry impossible: cached input payload missing fields',
      'kie_retry_unrecoverable'
    );
    return;
  }

  const quality = getImageModel(payload.imageQualityId as ImageQualityId);
  const callBackUrl = buildKieCallbackUrl(process.env.APP_URL);

  console.log(
    `[kie-watchdog] retrying createTask for orphan job ${job.id} (kind=${job.kind})`
  );
  // Bump attempts up-front so a slow / hung retry can't be retried
  // again by the next tick. The next tick will see attempts > 0 and
  // wait for the giveup window.
  await db
    .update(jobs)
    .set({ attempts: (job.attempts ?? 0) + 1 })
    .where(eq(jobs.id, job.id));

  try {
    const { taskId } = await kie.createTask({
      model: quality.kieModelId,
      input: {
        prompt: payload.userPrompt,
        input_urls: [payload.sourceImageUrl],
        aspect_ratio: 'auto',
        resolution: quality.resolution
      },
      ...(callBackUrl ? { callBackUrl } : {})
    });
    await db
      .update(jobs)
      .set({ kieTaskId: taskId, status: 'running', startedAt: new Date() })
      .where(eq(jobs.id, job.id));
    console.log(`[kie-watchdog] orphan ${job.id} recovered → kie task ${taskId}`);
  } catch (e) {
    // Couldn't reach kie — leave the row pending. The giveup branch
    // will refund the user once the 5-min cutoff lapses. We don't fail
    // immediately because a transient kie outage shouldn't burn the
    // user's credits.
    console.error(
      `[kie-watchdog] retry createTask network error for ${job.id}: ${(e as Error).message}`
    );
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
