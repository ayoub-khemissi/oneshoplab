import { eq } from 'drizzle-orm';
import { findLatestAuditStampForProject, type AuditStamp } from '@/entities/audit';
import { db } from '@/shared/db';
import { audits } from '@/shared/db/schema';
import type { SummaryShape } from '../lib/context';
import { buildSummaryIndex, type SummaryIndex } from '../lib/summary-index';

/**
 * The bulk worker used to load the latest audit — summary included, ~5 MB on
 * average and up to ~50 MB on a large catalog — and spread its product lists
 * on every pass, i.e. once per product of the bulk, to find one product. The
 * audit watchdog did the same per tick and pinned the worker at 300% CPU
 * (fc40706, 2026-09-28).
 *
 * Each pass now reads a stamp of the latest audit (small columns, never the
 * summary) and loads + indexes the summary again only when the stamp moves.
 * The stamp, not the id alone: a re-score rewrites the summary of the same
 * row in place (`run-audit/api/refresh.ts`).
 *
 * One slot: the worker serves one bulk at a time (the oldest in flight), so it
 * only ever needs that project's index, and `forgetSummaryIndex` drops it as
 * soon as no bulk is in flight.
 */
let slot: { projectId: string; stamp: string; index: SummaryIndex } | null = null;

function stampKey(stamp: AuditStamp | null): string {
  if (!stamp) return 'none';
  return [
    stamp.id,
    stamp.status,
    stamp.startedAt?.getTime() ?? '',
    stamp.completedAt?.getTime() ?? ''
  ].join('|');
}

export async function getSummaryIndex(
  projectId: string,
  domain: string | null
): Promise<SummaryIndex> {
  const latest = await findLatestAuditStampForProject(projectId, domain);
  const stamp = stampKey(latest);
  if (slot && slot.projectId === projectId && slot.stamp === stamp) return slot.index;

  // Drop the old index before loading the next summary, so both never sit in
  // the heap together.
  slot = null;
  const row = latest
    ? await db.query.audits.findFirst({
        where: eq(audits.id, latest.id),
        columns: { summary: true }
      })
    : null;
  const index = buildSummaryIndex((row?.summary ?? null) as SummaryShape | null);
  slot = { projectId, stamp, index };
  return index;
}

export function forgetSummaryIndex(): void {
  slot = null;
}
