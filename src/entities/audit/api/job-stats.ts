import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobs, type JobKind } from '@/lib/db/schema';

export interface JobKindStats {
  avgMs: number;
  /** Number of completed jobs included in the average. */
  count: number;
}

type JobRow = typeof jobs.$inferSelect;

/**
 * Wall-clock fallback durations are unreliable when the webhook was missed
 * and the watchdog reconciled minutes later — we'd record 20 minutes for an
 * image that actually generated in 30s. Anything above this cap is treated
 * as a measurement artifact and dropped.
 */
const MAX_FALLBACK_SECONDS = 600;

/**
 * Best-effort generation duration for a completed job, in seconds.
 *
 * Prefers `result.kieCostTimeSeconds` when present (this is what kie reports
 * as the actual wall-clock time spent generating, in seconds). Falls back to
 * our wall-clock from `started_at` to `finished_at`, capped at MAX_FALLBACK_SECONDS
 * to filter out artifacts from late watchdog reconciliations.
 */
export function durationSeconds(
  startedAt: Date | null,
  finishedAt: Date | null,
  result?: unknown
): number | null {
  if (result && typeof result === 'object' && result !== null) {
    const cost = (result as { kieCostTimeSeconds?: unknown }).kieCostTimeSeconds;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) {
      return Math.round(cost);
    }
  }
  if (!startedAt || !finishedAt) return null;
  const ms = finishedAt.getTime() - startedAt.getTime();
  if (ms <= 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds > MAX_FALLBACK_SECONDS) return null;
  return seconds;
}

function jobDurationMs(job: JobRow): number | null {
  const result = job.result as { kieCostTimeSeconds?: unknown } | null;
  if (result && typeof result.kieCostTimeSeconds === 'number') {
    const cost = result.kieCostTimeSeconds;
    if (Number.isFinite(cost) && cost > 0) return cost * 1000;
  }
  if (!job.startedAt || !job.finishedAt) return null;
  const ms = job.finishedAt.getTime() - job.startedAt.getTime();
  if (ms <= 0) return null;
  if (ms > MAX_FALLBACK_SECONDS * 1000) return null; // drop artifacts
  return ms;
}

/**
 * Compute the average duration per job kind across recent completed jobs.
 * Used to show a "typical: 30s" hint next to in-flight job placeholders so
 * the user knows what to expect.
 */
export async function getJobAverages(limit = 500): Promise<Partial<Record<JobKind, JobKindStats>>> {
  const completed = await db.query.jobs.findMany({
    where: and(eq(jobs.status, 'completed'), isNotNull(jobs.finishedAt)),
    orderBy: [desc(jobs.createdAt)],
    limit
  });

  const byKind = new Map<JobKind, number[]>();
  for (const j of completed) {
    const ms = jobDurationMs(j);
    if (ms == null) continue;
    const arr = byKind.get(j.kind) ?? [];
    arr.push(ms);
    byKind.set(j.kind, arr);
  }

  const out: Partial<Record<JobKind, JobKindStats>> = {};
  for (const [kind, samples] of byKind) {
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    out[kind] = { avgMs: avg, count: samples.length };
  }
  return out;
}
