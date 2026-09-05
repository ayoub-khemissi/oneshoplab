import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { CopyOptimField } from '@/entities/generation-job';
import { db } from '@/shared/db';
import { jobs } from '@/shared/db/schema';

export interface RecentChatJobs {
  inFlightChatJobs: Array<{ field: CopyOptimField; startedAtMs: number }>;
  recentFailedChatJobs: Array<{ jobId: string; field: CopyOptimField; error: string }>;
  /** Alt texts being written right now, by the photo they describe. A refresh
   *  must not lose a generation in progress — the job row is the truth, the
   *  client's transition is only a convenience. */
  inFlightAlts: Array<{ imageSrc: string; startedAtMs: number }>;
  /** A suggestion round in flight, if any: the merchant sees it resume rather
   *  than a button that pretends nothing was asked. */
  inFlightSuggestionStartedAtMs: number | null;
}

// Chat-job recovery window for F5: pull the last 5 min of chat job
// activity in one round-trip, then partition into "still running"
// (provider seeds spinner with the REAL submit time so the elapsed
// counter doesn't restart from 0) and "last attempt failed"
// (provider fires a one-shot toast so the merchant sees the failure
// they missed). The 5-min cutoff matches kie's chat ceiling (~90s)
// with margin; older rows are either orphans (server died mid-chat,
// very rare) or stale enough that the user has moved on.
export async function loadRecentChatJobs(productId: string): Promise<RecentChatJobs> {
  const RECENT_CUTOFF = new Date(Date.now() - 5 * 60 * 1000);
  const recentChatJobs = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      inputPayload: jobs.inputPayload,
      startedAt: jobs.startedAt,
      finishedAt: jobs.finishedAt,
      error: jobs.error
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.productId, productId),
        gt(jobs.startedAt, RECENT_CUTOFF),
        inArray(jobs.kind, [
          'kie_title',
          'kie_description',
          'kie_tags',
          'kie_alt_text',
          'kie_prompt_suggest'
        ])
      )
    )
    .orderBy(desc(jobs.startedAt));

  const kindToField = (kind: string): CopyOptimField | null =>
    kind === 'kie_title'
      ? 'title'
      : kind === 'kie_description'
        ? 'description'
        : kind === 'kie_tags'
          ? 'tags'
          : null;

  // Per field, keep only the most recent attempt (the query already
  // ordered desc by startedAt). That row tells us the current state:
  // running → restore spinner; failed → surface a toast; completed →
  // nothing to do (the new content is already in the product).
  const inFlightAlts: Array<{ imageSrc: string; startedAtMs: number }> = [];
  let inFlightSuggestionStartedAtMs: number | null = null;
  const seenFields = new Set<CopyOptimField>();
  const inFlightChatJobs: Array<{ field: CopyOptimField; startedAtMs: number }> = [];
  const recentFailedChatJobs: Array<{ jobId: string; field: CopyOptimField; error: string }> = [];
  for (const row of recentChatJobs) {
    if (row.kind === 'kie_alt_text') {
      const src = (row.inputPayload as { imageSrc?: string } | null)?.imageSrc;
      if (row.status === 'running' && row.startedAt && src) {
        inFlightAlts.push({ imageSrc: src, startedAtMs: row.startedAt.getTime() });
      }
      continue;
    }
    if (row.kind === 'kie_prompt_suggest') {
      if (row.status === 'running' && row.startedAt && inFlightSuggestionStartedAtMs === null) {
        inFlightSuggestionStartedAtMs = row.startedAt.getTime();
      }
      continue;
    }
    const field = kindToField(row.kind);
    if (!field || seenFields.has(field)) continue;
    seenFields.add(field);
    if (row.status === 'running' && row.startedAt) {
      inFlightChatJobs.push({ field, startedAtMs: row.startedAt.getTime() });
    } else if (row.status === 'failed') {
      // Raw kie message stays in the DB; client sanitises before
      // showing. We forward the raw form here so the sanitiser has
      // the full input to scrub.
      recentFailedChatJobs.push({
        jobId: row.id,
        field,
        error: row.error ?? 'generation_failed'
      });
    }
  }

  return { inFlightChatJobs, recentFailedChatJobs, inFlightAlts, inFlightSuggestionStartedAtMs };
}
