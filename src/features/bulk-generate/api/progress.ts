import { eq } from 'drizzle-orm';
import { db } from '@/shared/db';
import { notify } from '@/entities/notification';
import { jobs, projects, type JobStatus } from '@/shared/db/schema';
import { transitionJob, type TransitionOptions } from '@/entities/generation-job';
import type { BulkFieldKey, BulkProductState, BulkResult } from '../model/types';

export async function markFieldsErrored(
  jobId: string,
  result: BulkResult,
  productId: string,
  error: string,
  fields: BulkFieldKey[]
): Promise<void> {
  const state: BulkProductState = result.perProduct[productId] ?? { fields: {} };
  for (const f of fields) {
    if (!(f in state.fields)) state.fields[f] = { error };
  }
  result.perProduct[productId] = state;
  result.lastProgressAtMs = Date.now();
  await db
    .update(jobs)
    .set({ result: result as unknown as Record<string, unknown> })
    .where(eq(jobs.id, jobId));
}

export async function stopBulkOnInsufficient(jobId: string, result: BulkResult): Promise<void> {
  result.lastProgressAtMs = Date.now();
  await transitionJob(db, jobId, 'failed', {
    error: 'insufficient_credits',
    result: result as unknown as Record<string, unknown>
  });
  await emitBulkNotification(jobId, 'bulk_failed', 'insufficient_credits', result);
}

/**
 * Terminal flip + notification. With `tolerate` (watchdog) a refused
 * transition — the job finished under our feet — is logged and emits
 * no notification, since the flip didn't happen.
 */
export async function markJobStatus(
  jobId: string,
  status: JobStatus,
  errorText?: string,
  opts: TransitionOptions = {}
): Promise<void> {
  const res = await transitionJob(db, jobId, status, errorText ? { error: errorText } : {}, opts);
  if (res === 'refused') {
    console.warn(`[bulk] transition of ${jobId} → ${status} refused (job already terminal)`);
    return;
  }
  if (status === 'completed') {
    await emitBulkNotification(jobId, 'bulk_completed', null, null);
  } else if (status === 'failed') {
    await emitBulkNotification(jobId, 'bulk_failed', errorText ?? null, null);
  }
}

/** Resolve the bulk job's owner via project → user and emit one
 *  notification per terminal flip. Bulk runs are long (~minutes per
 *  product × N) and run in the worker, so the merchant is usually NOT
 *  watching when it finishes — isRead=false ticks the badge up. The
 *  payload carries a (generated, total) count derived from the
 *  result perProduct map when available, so the bell dropdown can
 *  render "23/30 produits générés" without re-reading the row. */
async function emitBulkNotification(
  jobId: string,
  kind: 'bulk_completed' | 'bulk_failed',
  errorMessage: string | null,
  result: BulkResult | null
): Promise<void> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { projectId: true, kind: true, inputPayload: true, result: true }
  });
  if (!job?.projectId || job.kind !== 'bulk_site_generate') return;
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, job.projectId),
    columns: { userId: true }
  });
  if (!project?.userId) return;

  const payload: Record<string, unknown> = {};
  if (errorMessage) payload.errorMessage = errorMessage;
  // Re-read result if we don't have it in scope (markJobStatus path).
  const final = result ?? (job.result as BulkResult | null) ?? null;
  if (final?.perProduct) {
    const total = Object.keys(final.perProduct).length;
    let generated = 0;
    for (const state of Object.values(final.perProduct)) {
      const fields = state?.fields ?? {};
      const hasAnyDone = Object.values(fields).some(
        (v) => v === 'done' || (typeof v === 'object' && v !== null && !('error' in v))
      );
      if (hasAnyDone) generated += 1;
    }
    payload.generated = generated;
    payload.total = total;
  }
  await notify({
    userId: project.userId,
    kind,
    jobId,
    projectId: job.projectId,
    payload
  });
}
