import { and, desc, eq, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobs, type JobStatus } from '@/lib/db/schema';
import {
  ALL_FIELDS,
  effectiveFields,
  readResult,
  resolveBulkPrefs,
  type BulkFieldKey,
  type BulkInputPayload,
  type BulkProductState,
  type BulkResult
} from '../model/types';

export interface BulkJobStatusForUi {
  id: string;
  status: JobStatus;
  error: string | null;
  total: number;
  /** All four fields recorded as 'done'. */
  fullySucceeded: number;
  /** Mix of 'done' and { error } across the four fields. */
  partiallySucceeded: number;
  /** All four fields errored. */
  fullyFailed: number;
  /** Sum of products with at least one field still missing. */
  notYetAttempted: number;
  /** Per-product detail so the UI can render the failure modal. */
  perProduct: Record<string, BulkProductState>;
}

function aggregate(
  result: BulkResult,
  total: number,
  fields: BulkFieldKey[]
): {
  fullySucceeded: number;
  partiallySucceeded: number;
  fullyFailed: number;
  notYetAttempted: number;
} {
  let fullySucceeded = 0;
  let partiallySucceeded = 0;
  let fullyFailed = 0;
  const want = fields.length > 0 ? fields : ALL_FIELDS;
  for (const state of Object.values(result.perProduct)) {
    const present = want.filter((f) => f in state.fields);
    if (present.length < want.length) continue;
    const doneCount = present.filter((f) => state.fields[f] === 'done').length;
    if (doneCount === want.length) fullySucceeded++;
    else if (doneCount === 0) fullyFailed++;
    else partiallySucceeded++;
  }
  const attempted = fullySucceeded + partiallySucceeded + fullyFailed;
  return {
    fullySucceeded,
    partiallySucceeded,
    fullyFailed,
    notYetAttempted: Math.max(0, total - attempted)
  };
}

/** Active (non-terminal) bulk for a site, if any. */
export async function getActiveBulkJob(projectId: string): Promise<{
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  errors: number;
} | null> {
  const job = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, 'bulk_site_generate'),
      or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))
    ),
    orderBy: [desc(jobs.createdAt)]
  });
  if (!job) return null;
  const result = readResult(job.result);
  const snap = job.inputPayload as unknown as BulkInputPayload | null;
  const agg = aggregate(
    result,
    result.total,
    effectiveFields(
      resolveBulkPrefs(snap ? { fields: snap.fields, imageAngles: snap.imageAngles } : null)
    )
  );
  // For the simple progress bar we count attempts of any kind.
  const processed = agg.fullySucceeded + agg.partiallySucceeded + agg.fullyFailed;
  const errors = agg.partiallySucceeded + agg.fullyFailed;
  return {
    id: job.id,
    status: job.status,
    total: result.total,
    processed,
    errors
  };
}

/** Most recent bulk for a site (any status), with full per-product
 *  state for the failure-detail modal. */
export async function getLatestBulkJobDetail(
  projectId: string
): Promise<BulkJobStatusForUi | null> {
  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.projectId, projectId), eq(jobs.kind, 'bulk_site_generate')),
    orderBy: [desc(jobs.createdAt)]
  });
  if (!job) return null;
  const result = readResult(job.result);
  const snap = job.inputPayload as unknown as BulkInputPayload | null;
  const agg = aggregate(
    result,
    result.total,
    effectiveFields(
      resolveBulkPrefs(snap ? { fields: snap.fields, imageAngles: snap.imageAngles } : null)
    )
  );
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    total: result.total,
    perProduct: result.perProduct,
    ...agg
  };
}
