import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction, InsufficientCreditsError } from '@/lib/credits';
import { persistKieJobFailure } from './persist-result';
import { db } from '@/lib/db';
import { jobs, products, users } from '@/lib/db/schema';
import { buildKieCallbackUrl, getKieClient } from './kie';
import { costForImage, getImageModel, type ImageQualityId } from './models';

/** Legacy default — used when no quality is passed. Mirrors `costForImage('image-1k')`. */
const IMAGE_COST_CREDITS = costForImage('image-1k');

export interface StartImageOptimOptions {
  userId: string;
  projectId: string;
  productSourceId: string;
  sourceImageUrl: string;
  userPrompt: string;
  /** Public origin used to build the kie webhook callback URL. */
  appUrl?: string;
  /** Caller-selected image quality. Falls back to the user's preference / default. */
  imageQualityId?: ImageQualityId;
}

export interface StartImageOptimResult {
  jobId: string;
  /** null when kie's createTask failed and the OpenRouter fallback
   *  completed the job synchronously instead. */
  kieTaskId: string | null;
  creditsHeld: number;
}

/**
 * Kick off an image-to-image generation:
 *   1. Hold credits (idempotent debit, refunded on synchronous failure).
 *   2. Persist a `kie_image_edit` job before the kie call.
 *   3. POST createTask to kie with our webhook URL.
 *   4. Save the returned taskId on the job so the webhook can match it.
 *
 * The result image arrives later via /api/kie/callback (or the worker's
 * kie-watchdog as a poll fallback).
 */
export async function startImageOptim(
  opts: StartImageOptimOptions
): Promise<StartImageOptimResult> {
  const quality = getImageModel(opts.imageQualityId);
  const cost = costForImage(quality.id);

  const user = await db.query.users.findFirst({ where: eq(users.id, opts.userId) });
  if (!user) throw new Error(`User ${opts.userId} not found`);
  if (user.creditsBalance < cost) {
    throw new InsufficientCreditsError(cost, user.creditsBalance);
  }

  const jobId = randomUUID();
  const callBackUrl = buildKieCallbackUrl(opts.appUrl);

  // Resolve product FK so the Activity tab can render a product
  // link instead of "—" (same rationale as runChatOptim).
  const productRow = await db.query.products.findFirst({
    where: and(eq(products.projectId, opts.projectId), eq(products.sourceId, opts.productSourceId)),
    columns: { id: true }
  });

  await db.insert(jobs).values({
    id: jobId,
    projectId: opts.projectId,
    productId: productRow?.id ?? null,
    kind: 'kie_image_edit',
    status: 'pending',
    inputPayload: {
      productSourceId: opts.productSourceId,
      field: 'images',
      userPrompt: opts.userPrompt,
      sourceImageUrl: opts.sourceImageUrl,
      imageQualityId: quality.id
    },
    creditsCost: cost,
    startedAt: new Date()
  });

  // Hold the credits up-front. Refunded if createTask fails synchronously.
  // The job row must exist first (the ledger row references it), so if
  // the hold itself fails — insufficient balance once the row lock
  // serializes concurrent holds, or a DB error — remove the orphan job
  // rather than leave a pending, never-charged row that a late kie
  // callback could still complete for free.
  try {
    await applyCreditTransaction({
      userId: opts.userId,
      delta: -cost,
      reason: 'kie_image_edit',
      jobId,
      idempotencyKey: `job-${jobId}`
    });
  } catch (e) {
    await db.delete(jobs).where(eq(jobs.id, jobId));
    throw e;
  }

  const kie = getKieClient();
  try {
    const { taskId } = await kie.createTask({
      model: quality.kieModelId,
      input: {
        prompt: opts.userPrompt,
        input_urls: [opts.sourceImageUrl],
        aspect_ratio: 'auto',
        resolution: quality.resolution
      },
      ...(callBackUrl ? { callBackUrl } : {})
    });

    await db.update(jobs).set({ kieTaskId: taskId, status: 'running' }).where(eq(jobs.id, jobId));

    return { jobId, kieTaskId: taskId, creditsHeld: cost };
  } catch (e) {
    const message = (e as Error).message;
    // Fail through the shared path: it tries the OpenRouter image
    // fallback first (same prompt + source), and only then flips the
    // job to failed + refunds (idempotency key `job-<id>-refund`).
    await persistKieJobFailure(jobId, 'kie_image_edit', message, 'kie_create_failed');
    const after = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { status: true }
    });
    if (after?.status === 'completed') {
      return { jobId, kieTaskId: null, creditsHeld: cost };
    }

    throw e;
  }
}

export { IMAGE_COST_CREDITS };
