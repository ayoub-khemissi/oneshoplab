/**
 * The ONE place that changes `jobs.status`.
 *
 * Every status write used to be an ad-hoc `db.update(jobs).set({ status })`
 * scattered over the worker, the kie callback, retries and bulk runs — which
 * is how a completed job could be re-failed by a late watchdog tick, or a
 * refund issued twice. `transitionJob` makes the write a guarded UPDATE
 * (`WHERE status IN (allowed sources)`), so an illegal move is refused at
 * the database and reported, not silently applied.
 *
 *   pending   → running | completed | failed | timed_out
 *   running   → completed | failed | timed_out           (+ running: refresh)
 *   failed    → pending | running                        (retry)
 *   timed_out → pending | running                        (retry)
 *   completed → ∅  (only `force: true` re-opens it: pending | running)
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobs, type JobStatus } from '@/lib/db/schema';

export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['completed', 'failed', 'timed_out'];

/** Allowed *sources* for each target status (self-loops listed explicitly). */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ['failed', 'timed_out'],
  running: ['pending', 'running', 'failed', 'timed_out'],
  completed: ['pending', 'running'],
  failed: ['pending', 'running'],
  timed_out: ['pending', 'running']
};

/** Sources additionally allowed when the caller passes `force: true`. */
const FORCED_TRANSITIONS: Partial<Record<JobStatus, readonly JobStatus[]>> = {
  pending: ['completed'],
  running: ['completed']
};

export function canTransition(from: JobStatus, to: JobStatus, force = false): boolean {
  if (JOB_TRANSITIONS[to].includes(from)) return true;
  return force ? (FORCED_TRANSITIONS[to]?.includes(from) ?? false) : false;
}

export class IllegalJobTransition extends Error {
  constructor(
    public readonly jobId: string,
    public readonly from: JobStatus,
    public readonly to: JobStatus
  ) {
    super(`job ${jobId}: illegal transition ${from} → ${to}`);
    this.name = 'IllegalJobTransition';
  }
}

export class JobNotFound extends Error {
  constructor(public readonly jobId: string) {
    super(`job ${jobId} not found`);
    this.name = 'JobNotFound';
  }
}

type JobPatch = Partial<Omit<typeof jobs.$inferInsert, 'id' | 'status'>>;

export interface TransitionOptions {
  /** Re-open a completed job (manual retry with force). */
  force?: boolean;
  /**
   * Return 'refused' instead of throwing when the job is in a state the
   * target can't be reached from — for best-effort callers like watchdogs
   * that must not crash on a job that finished under their feet.
   */
  tolerate?: boolean;
}

export type TransitionResult = 'applied' | 'refused';

/**
 * Move a job to `to`, applying `patch` in the same statement. `startedAt`
 * is stamped on the first move to running, `finishedAt` on any terminal
 * status (both overridable through `patch`). Throws IllegalJobTransition /
 * JobNotFound unless `tolerate` is set.
 */
export async function transitionJob(
  exec: DbExecutor,
  jobId: string,
  to: JobStatus,
  patch: JobPatch = {},
  opts: TransitionOptions = {}
): Promise<TransitionResult> {
  const sources = [...JOB_TRANSITIONS[to], ...(opts.force ? (FORCED_TRANSITIONS[to] ?? []) : [])];
  const now = new Date();
  const values: Partial<typeof jobs.$inferInsert> = { ...patch, status: to };
  if (to === 'running' && patch.startedAt === undefined) {
    values.startedAt = sql`COALESCE(${jobs.startedAt}, ${now})` as unknown as Date;
  }
  if (TERMINAL_JOB_STATUSES.includes(to) && patch.finishedAt === undefined) {
    values.finishedAt = now;
  }
  if ((to === 'pending' || to === 'running') && patch.finishedAt === undefined) {
    // A retry re-opens the job: clear the previous end marker.
    values.finishedAt = null;
  }

  const [res] = await exec
    .update(jobs)
    .set(values)
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, sources)));
  if (res.affectedRows > 0) return 'applied';

  const [row] = await exec.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
  if (!row) {
    if (opts.tolerate) return 'refused';
    throw new JobNotFound(jobId);
  }
  if (opts.tolerate) return 'refused';
  throw new IllegalJobTransition(jobId, row.status, to);
}
