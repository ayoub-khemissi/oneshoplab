import { eq } from 'drizzle-orm';
import { applyCreditTransaction } from '@/entities/credit';
import { db } from '@/shared/db';
import { jobs, products, projects, type JobKind } from '@/shared/db/schema';
import { transitionJob } from './transitions';
import { notify } from '@/entities/notification';
import { generateFallbackImage, isImageFallbackConfigured } from '@/entities/ai-provider';
import { getImageFormat } from '@/entities/ai-model';

// The failure + refund path, apart from persist-result so the job starters
// (image-optim, remove-background) can fail a job without importing the
// success path — which itself starts remove-background (chained cut-outs).

const IMAGE_KINDS: JobKind[] = ['kie_image_edit', 'kie_image_generate'];

export function isImageJob(kind: string): boolean {
  return (IMAGE_KINDS as string[]).includes(kind);
}

/** Walk job → project to get userId, then log the image outcome. The
 *  user is most often NOT staring at the image grid when the kie
 *  callback fires (image generation is async ~minutes), so we leave
 *  isRead=false and let the bell badge tick up. The product title
 *  goes into the payload so the bell renders "Image générée ·
 *  Tee-shirt orange" rather than the bare job kind. */
export async function emitImageNotification(
  jobId: string,
  kind: 'image_completed' | 'image_failed',
  errorMessage: string | null
): Promise<void> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { projectId: true, productId: true, inputPayload: true }
  });
  if (!job?.projectId) return;
  // Part of a bulk run: the run itself reports at the end, and one push per
  // photo across a catalogue is an alarm going off all afternoon.
  if ((job.inputPayload as { silent?: boolean } | null)?.silent) return;
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, job.projectId),
    columns: { userId: true }
  });
  if (!project?.userId) return;
  let productTitle: string | null = null;
  if (job.productId) {
    const p = await db.query.products.findFirst({
      where: eq(products.id, job.productId),
      columns: { title: true }
    });
    if (p?.title) productTitle = p.title.slice(0, 80);
  }
  const payload: Record<string, unknown> = {};
  if (productTitle) payload.productTitle = productTitle;
  if (errorMessage) payload.errorMessage = errorMessage;
  await notify({
    userId: project.userId,
    kind,
    jobId,
    productId: job.productId ?? null,
    projectId: job.projectId,
    payload: Object.keys(payload).length > 0 ? payload : null
  });
}

/**
 * Persist a failed kie task result. For image jobs we refund the credits
 * that were held up-front when the job was created.
 */
export async function persistKieJobFailure(
  jobId: string,
  jobKind: string,
  failMsg: string | null | undefined,
  failCode: string | null | undefined
): Promise<void> {
  const errorText = failMsg ?? failCode ?? 'kie reported failure';

  // Image jobs: before failing + refunding, try the OpenRouter fallback
  // model with the same prompt/source. Skipped when the merchant cancelled
  // (they don't want the image), when R2 itself is the problem (the
  // fallback would fail the same upload), or when the fallback isn't
  // configured. On success the job completes normally and the original
  // credit hold stands — the merchant paid for an image and got one.
  const fallbackEligible =
    isImageJob(jobKind) &&
    isImageFallbackConfigured() &&
    failCode !== 'cancelled_by_user' &&
    failMsg !== 'r2_persist_failed' &&
    failCode !== 'fallback_failed';
  if (fallbackEligible) {
    const rescued = await tryImageFallback(jobId, jobKind, errorText);
    if (rescued) return;
  }

  // Read the job *first* so we can decide whether to flip it to failed
  // and whether to issue a refund. Two terminal-state guards live here:
  //   - if the row is already `completed`, we don't change status (the
  //     image was actually delivered) and we don't refund (would credit
  //     the user for a successful delivery).
  //   - if the row is already `failed` / `timed_out`, we leave it; the
  //     refund's idempotency key still keeps it safe but we save the
  //     write and avoid pointlessly clobbering the original error.
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return;
  if (job.status !== 'pending' && job.status !== 'running') return;

  const r = await transitionJob(db, jobId, 'failed', { error: errorText }, { tolerate: true });
  if (r === 'refused') {
    console.warn(`[persist-result] job ${jobId}: → failed refused (already terminal)`);
  }

  if (!isImageJob(jobKind)) return;

  if (!job.projectId || job.creditsCost <= 0) return;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, job.projectId)
  });
  if (!project?.userId) return;

  await applyCreditTransaction({
    userId: project.userId,
    delta: job.creditsCost,
    reason: `${jobKind}_refund`,
    jobId,
    idempotencyKey: `job-${jobId}-refund`
  });

  await emitImageNotification(jobId, 'image_failed', errorText);
}

/**
 * Regenerate a failed image job through the catalog's fallback model and
 * complete the job with the R2 URL. Returns false (and logs) when the
 * fallback itself fails so the caller proceeds with the normal
 * fail + refund path. Terminal-state guard mirrors persistKieJobSuccess.
 */
async function tryImageFallback(
  jobId: string,
  jobKind: string,
  originalError: string
): Promise<boolean> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job || (job.status !== 'pending' && job.status !== 'running')) return false;
  const input = job.inputPayload as {
    userPrompt?: string;
    sourceImageUrl?: string;
    imageFormatId?: string;
  } | null;
  // A cut-out has nothing to re-generate — straight to refund.
  if (!input?.userPrompt || (input as { op?: string }).op === 'remove_bg') return false;
  try {
    const r = await generateFallbackImage({
      jobId,
      prompt: input.userPrompt,
      sourceImageUrl: input.sourceImageUrl ?? null,
      // The merchant picked a ratio for a placement; a fallback that ignores
      // it hands back an image that doesn't fit where it was going.
      aspectRatio: getImageFormat(input.imageFormatId).aspectRatio
    });
    const prev = (job.result && typeof job.result === 'object' ? job.result : {}) as Record<
      string,
      unknown
    >;
    const res = await transitionJob(
      db,
      jobId,
      'completed',
      {
        error: null,
        result: {
          ...prev,
          resultUrls: [],
          persistedUrls: [r.publicUrl],
          provider: 'openrouter',
          providerModel: r.model,
          providerUnitsConsumed: r.providerUnits,
          fallbackFrom: originalError.slice(0, 200)
        }
      },
      { tolerate: true }
    );
    if (res === 'refused') {
      console.warn(
        `[persist-result] job ${jobId}: fallback → completed refused (already terminal)`
      );
    }
    console.warn(
      `[persist-result] image job ${jobId} rescued by fallback ${r.model} (kie: ${originalError.slice(0, 80)})`
    );
    await emitImageNotification(jobId, 'image_completed', null);
    return true;
  } catch (e) {
    console.error(`[persist-result] image fallback failed for job ${jobId}:`, (e as Error).message);
    return false;
  }
}
