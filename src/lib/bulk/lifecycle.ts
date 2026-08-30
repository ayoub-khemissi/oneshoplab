import { and, eq, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  CHAT_MODEL_REGISTRY,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODEL_REGISTRY,
  type ChatModelId,
  type ImageQualityId
} from '@/entities/ai-model';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import { transitionJob } from '@/entities/generation-job';
import {
  readResult,
  resolveBulkPrefs,
  type BulkInputPayload,
  type BulkResult,
  type ResolvedBulkPrefs
} from '@/lib/bulk/types';

/**
 * Insert the parent bulk job atomically. The (existence-check, insert)
 * pair runs inside a DB transaction so two concurrent submits can't
 * each see "no active bulk" and both insert. The second one finds the
 * first inside the same transaction window and returns an error that
 * the API route surfaces as 409.
 */
export async function startBulkSiteGenerate(opts: {
  projectId: string;
  productIds: string[];
  chatModelId?: ChatModelId;
  imageQualityId?: ImageQualityId;
  customInstructions?: string;
  totalCreditsBudget: number;
  /** Resolved site prefs, snapshotted into the payload so the worker
   *  is deterministic even if the site prefs change mid-run. */
  prefs?: ResolvedBulkPrefs;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: 'already_running' }> {
  const id = randomUUID();
  const chatModelId =
    opts.chatModelId && opts.chatModelId in CHAT_MODEL_REGISTRY
      ? opts.chatModelId
      : DEFAULT_CHAT_MODEL;
  const imageQualityId =
    opts.imageQualityId && opts.imageQualityId in IMAGE_MODEL_REGISTRY
      ? opts.imageQualityId
      : DEFAULT_IMAGE_QUALITY;

  const prefs = opts.prefs ?? resolveBulkPrefs(null);
  const input: BulkInputPayload = {
    siteId: opts.projectId,
    productIds: opts.productIds,
    chatModelId,
    imageQualityId,
    customInstructions: opts.customInstructions ?? '',
    fields: prefs.fields,
    imageAngles: prefs.imageAngles
  };
  const result: BulkResult = {
    total: opts.productIds.length,
    totalCreditsBudget: opts.totalCreditsBudget,
    lastProgressAtMs: null,
    perProduct: {}
  };

  const inserted = await db.transaction(async (tx) => {
    const existing = await tx.query.jobs.findFirst({
      where: and(
        eq(jobs.projectId, opts.projectId),
        eq(jobs.kind, 'bulk_site_generate'),
        or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))
      )
    });
    if (existing) return null;
    await tx.insert(jobs).values({
      id,
      projectId: opts.projectId,
      kind: 'bulk_site_generate',
      status: 'pending',
      inputPayload: input as unknown as Record<string, unknown>,
      result: result as unknown as Record<string, unknown>,
      creditsCost: 0
    });
    return id;
  });

  if (!inserted) return { ok: false, reason: 'already_running' };
  return { ok: true, jobId: inserted };
}

/**
 * Take a bulk job that ended (any terminal state) and queue a new
 * one targeting only the productIds whose previous run had at least
 * one field error. Combined with the worker's per-field skip, this
 * means the retry only re-attempts the actually-failed fields and
 * doesn't re-bill the ones that succeeded.
 *
 * Uses the same atomic-insert path as a fresh start, so it 409s if
 * a bulk is already running for the same site.
 */
export async function retryFailedFromBulk(opts: {
  projectId: string;
  sourceJobId: string;
  chatModelId?: ChatModelId;
  imageQualityId?: ImageQualityId;
  customInstructions?: string;
  totalCreditsBudget: number;
}): Promise<
  | { ok: true; jobId: string; productCount: number }
  | { ok: false; reason: 'already_running' | 'source_not_found' | 'no_failures' }
> {
  const source = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.id, opts.sourceJobId),
      eq(jobs.projectId, opts.projectId),
      eq(jobs.kind, 'bulk_site_generate')
    )
  });
  if (!source) return { ok: false, reason: 'source_not_found' };

  const sourceResult = readResult(source.result);
  const failedProductIds = Object.entries(sourceResult.perProduct)
    .filter(([, state]) => Object.values(state.fields).some((v) => v && v !== 'done'))
    .map(([id]) => id);
  if (failedProductIds.length === 0) {
    return { ok: false, reason: 'no_failures' };
  }

  // Reuse the ORIGINAL bulk's field/angle selection (snapshot), not the
  // site's current prefs — a retry must re-attempt exactly what the
  // first run targeted.
  const srcInput = source.inputPayload as unknown as BulkInputPayload | null;
  const out = await startBulkSiteGenerate({
    projectId: opts.projectId,
    productIds: failedProductIds,
    chatModelId: opts.chatModelId,
    imageQualityId: opts.imageQualityId,
    customInstructions: opts.customInstructions,
    totalCreditsBudget: opts.totalCreditsBudget,
    prefs: resolveBulkPrefs(
      srcInput ? { fields: srcInput.fields, imageAngles: srcInput.imageAngles } : null
    )
  });
  if (!out.ok) return { ok: false, reason: 'already_running' };
  return { ok: true, jobId: out.jobId, productCount: failedProductIds.length };
}

/**
 * Cancel an in-flight bulk job. Best-effort: any per-field work
 * already committed in the current tick is kept (the credit ledger
 * and chat job rows are independent and durable). Future ticks see
 * the cancelled status and skip this row.
 */
export async function cancelBulkJob(jobId: string, projectId: string): Promise<boolean> {
  // The ownership + kind guard used to live in the UPDATE's WHERE;
  // transitionJob only scopes by id, so check it up front.
  const owned = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.id, jobId),
      eq(jobs.projectId, projectId),
      eq(jobs.kind, 'bulk_site_generate')
    ),
    columns: { id: true }
  });
  if (!owned) return true;
  // A refused transition means the job was already terminal (completed /
  // earlier cancel). We treat that as "no-op success" — caller doesn't care.
  const res = await transitionJob(
    db,
    jobId,
    'failed',
    { error: 'cancelled_by_user' },
    { tolerate: true }
  );
  if (res === 'refused') {
    console.warn(`[bulk] cancel of ${jobId} refused (job already terminal)`);
  }
  return true;
}
