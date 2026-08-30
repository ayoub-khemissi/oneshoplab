import { and, asc, eq, lt, or } from 'drizzle-orm';
import { buildImagePrompt, startImageOptim } from '@/entities/generation-job';
import { runChatOptim } from '@/entities/generation-job';
import { getEffectiveLanguage } from '@/entities/audit';
import { InsufficientCreditsError } from '@/entities/credit';
import { db } from '@/shared/db';
import { jobs, projects, products } from '@/shared/db/schema';
import { transitionJob } from '@/entities/generation-job';
import {
  combineInstructions,
  effectiveChatPrompt,
  toProductContext,
  type SummaryProduct,
  type SummaryShape
} from '../lib/context';
import { hasExistingCompletedField } from './planning';
import { markFieldsErrored, markJobStatus, stopBulkOnInsufficient } from './progress';
import {
  BULK_STALL_TIMEOUT_MS,
  effectiveFields,
  readResult,
  resolveBulkPrefs,
  type BulkInputPayload,
  type BulkProductState
} from '../model/types';

// ---------------------------------------------------------------------------
// Worker tick
// ---------------------------------------------------------------------------

/**
 * Worker tick. Returns true when work happened (caller can keep
 * ticking tightly), false when nothing was queued.
 */
export async function processNextBulkProduct(): Promise<boolean> {
  // FIFO so the oldest queued bulk drains first; older bug picked the
  // newest, which let a freshly-launched bulk leapfrog an in-flight
  // one for another site.
  const job = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.kind, 'bulk_site_generate'),
      or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))
    ),
    orderBy: [asc(jobs.createdAt)]
  });
  if (!job) return false;

  const input = job.inputPayload as unknown as BulkInputPayload | null;
  const result = readResult(job.result);
  if (!input || !job.projectId) {
    await markJobStatus(job.id, 'failed', 'Bulk job has no input payload');
    return true;
  }

  // Effective selection for THIS job — from the payload snapshot taken
  // at launch (legacy jobs with no snapshot → all fields, 3 angles).
  const prefs = resolveBulkPrefs({
    fields: input.fields,
    imageAngles: input.imageAngles
  });
  const wanted = effectiveFields(prefs);

  // Flip pending → running on first touch and stamp progressAt so the
  // stall watchdog has a reference.
  if (job.status === 'pending') {
    result.lastProgressAtMs = Date.now();
    await transitionJob(db, job.id, 'running', {
      result: result as unknown as Record<string, unknown>
    });
  }

  // Find the next product not yet fully attempted (every field has
  // either 'done' or { error } recorded).
  const nextProductId = input.productIds.find((pid) => {
    const state = result.perProduct[pid];
    if (!state) return true;
    return wanted.some((f) => !(f in state.fields));
  });

  if (!nextProductId) {
    await markJobStatus(job.id, 'completed');
    return true;
  }

  // Resolve project + product context.
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, job.projectId)
  });
  if (!project) {
    await markJobStatus(job.id, 'failed', 'Project not found');
    return true;
  }

  const { findLatestAuditForProject } = await import('@/entities/audit');
  const audit = await findLatestAuditForProject(project.id, project.domain);

  const summary = (audit?.summary ?? null) as SummaryShape | null;
  const all: SummaryProduct[] = summary
    ? [
        ...(summary.allProducts ?? []),
        ...(summary.worstProducts ?? []),
        ...(summary.latestProducts ?? []),
        ...(summary.bestProducts ?? [])
      ]
    : [];

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, nextProductId), eq(products.projectId, project.id))
  });
  if (!productRow) {
    await markFieldsErrored(job.id, result, nextProductId, 'Product row not found', wanted);
    return true;
  }

  const matched =
    all.find((p) => {
      if (productRow.sourceId && p.sourceId === productRow.sourceId) return true;
      if (productRow.handle && p.handle === productRow.handle) return true;
      return false;
    }) ?? null;
  if (!matched) {
    await markFieldsErrored(
      job.id,
      result,
      nextProductId,
      'Product missing from latest audit summary — relaunch the audit before bulking',
      wanted
    );
    return true;
  }
  const sourceId = matched.sourceId ?? matched.handle ?? '';
  const sourceImage = matched.images[0]?.src ?? null;
  if (!sourceId) {
    await markFieldsErrored(job.id, result, nextProductId, 'Product has no source id', wanted);
    return true;
  }

  const merchantInstructions = combineInstructions(
    project.customInstructions ?? null,
    productRow.customInstructions ?? input.customInstructions ?? ''
  );
  const languageCode = await getEffectiveLanguage(project.id);
  const context = toProductContext(matched);

  const state: BulkProductState = result.perProduct[nextProductId] ?? { fields: {} };
  result.perProduct[nextProductId] = state;

  // Process each field independently — atomic failure granularity.
  // After each field, persist + re-check parent status so a cancel
  // request lands quickly. If credits run out, mark the remaining
  // fields as errored with a clear message and stop the bulk.
  for (const field of wanted) {
    if (field in state.fields) continue;

    // Cancellation re-check between fields. The status was loaded at
    // the top of the tick; could have flipped via DELETE since.
    const fresh = await db.query.jobs.findFirst({
      where: eq(jobs.id, job.id),
      columns: { status: true, error: true }
    });
    if (!fresh || (fresh.status !== 'running' && fresh.status !== 'pending')) {
      // Cancelled or already finalised by another path; bail without
      // touching the row further.
      return true;
    }

    // Skip fields that already have a non-hidden completed generation
    // (created by a per-product action, an earlier bulk, or this bulk
    // before it crashed). Bulk never overwrites existing AI output —
    // its job is to fill the gaps, not to re-pay for work already done.
    if (await hasExistingCompletedField(project.id, sourceId, field)) {
      state.fields[field] = 'done';
      result.lastProgressAtMs = Date.now();
      await db
        .update(jobs)
        .set({ result: result as unknown as Record<string, unknown> })
        .where(eq(jobs.id, job.id));
      continue;
    }

    try {
      if (field === 'images') {
        if (!sourceImage) {
          state.fields.images = { error: 'No source image on this product' };
        } else {
          const settled = await Promise.allSettled(
            prefs.imageAngles.map((angle) =>
              startImageOptim({
                userId: project.userId,
                projectId: project.id,
                productSourceId: sourceId,
                sourceImageUrl: sourceImage,
                userPrompt: buildImagePrompt(angle, '', merchantInstructions),
                appUrl: process.env.APP_URL,
                imageQualityId: input.imageQualityId
              })
            )
          );
          const allFailed = settled.every((s) => s.status === 'rejected');
          if (allFailed) {
            const reason =
              (settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined)
                ?.reason ?? null;
            const message = reason instanceof Error ? reason.message : 'Image fan-out failed';
            state.fields.images = { error: message };
          } else {
            state.fields.images = 'done';
          }
        }
      } else {
        await runChatOptim({
          userId: project.userId,
          projectId: project.id,
          productSourceId: sourceId,
          field,
          userPrompt: effectiveChatPrompt(field, merchantInstructions),
          product: context,
          chatModelId: input.chatModelId,
          languageCode
        });
        state.fields[field] = 'done';
      }
    } catch (e) {
      // Insufficient credits is the one error worth aborting the entire
      // bulk for — every subsequent product / field will hit the same
      // wall. Mark this field + everything still pending as errored,
      // flip the bulk to failed, and exit.
      if (e instanceof InsufficientCreditsError) {
        state.fields[field] = { error: 'insufficient_credits' };
        await stopBulkOnInsufficient(job.id, result);
        return true;
      }
      const msg = (e as Error).message ?? 'Unknown error';
      state.fields[field] = { error: msg };
    }

    result.lastProgressAtMs = Date.now();
    await db
      .update(jobs)
      .set({ result: result as unknown as Record<string, unknown> })
      .where(eq(jobs.id, job.id));
  }

  return true;
}

// ---------------------------------------------------------------------------
// Stall watchdog
// ---------------------------------------------------------------------------

/**
 * Reaper for bulks stuck in 'running' that haven't written progress
 * within BULK_STALL_TIMEOUT_MS. Runs once per worker tick alongside
 * kie-watchdog; cheap when nothing is stuck.
 */
export async function runBulkWatchdog(): Promise<void> {
  const stuck = await db.query.jobs.findMany({
    where: and(
      eq(jobs.kind, 'bulk_site_generate'),
      eq(jobs.status, 'running'),
      lt(jobs.startedAt, new Date(Date.now() - BULK_STALL_TIMEOUT_MS))
    ),
    limit: 5
  });
  if (stuck.length === 0) return;

  for (const job of stuck) {
    const result = readResult(job.result);
    const lastProgress = result.lastProgressAtMs ?? job.startedAt?.getTime() ?? 0;
    if (Date.now() - lastProgress < BULK_STALL_TIMEOUT_MS) continue;
    console.warn(
      `[bulk-watchdog] reaping stalled bulk ${job.id} (no progress for ${
        (Date.now() - lastProgress) / 1000
      }s)`
    );
    // Best-effort: the bulk may have finished between the query and here.
    await markJobStatus(job.id, 'failed', 'bulk_stalled', { tolerate: true });
  }
}
