import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction } from '@/lib/credits';
import { db } from '@/lib/db';
import { jobs, products, projects, type JobKind } from '@/lib/db/schema';
import { notify } from '@/lib/notifications';
import { isR2Configured, uploadFromUrl } from '@/lib/storage';
import { generateFallbackImage, isImageFallbackConfigured } from './image-fallback';

const IMAGE_KINDS: JobKind[] = ['kie_image_edit', 'kie_image_generate'];

function isImageJob(kind: string): boolean {
  return (IMAGE_KINDS as string[]).includes(kind);
}

/**
 * Upload a kie temp image to R2, retrying transient failures (the
 * download from kie's temp host or the PutObject can flake). Returns
 * the persisted public R2 URL, or null when every attempt failed —
 * the caller MUST then fail the job rather than store a temp URL,
 * because temp URLs (tempfile.aiquickdraw.com) 404 days later and
 * silently break the image.
 */
async function persistToR2WithRetry(
  sourceUrl: string,
  key: string,
  attempts = 4
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await uploadFromUrl(sourceUrl, key);
      return r.publicUrl;
    } catch (e) {
      const last = i === attempts - 1;
      console.error(
        `[persist-result] R2 upload attempt ${i + 1}/${attempts} failed for ${key}${last ? ' (giving up)' : ''}`,
        (e as Error).message
      );
      if (last) return null;
      // Linear backoff: 0.5s, 1s, 1.5s.
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  return null;
}

export interface KieSuccessMeta {
  /** kie.data.costTime — seconds spent on kie's side generating. Authoritative
   *  for image jobs since wall-clock between our insert and our update can
   *  be much longer (e.g. when the webhook callback was unreachable). */
  costTimeSeconds?: number | null;
}

/**
 * Persist a successful kie task result on the matching job row.
 * For image jobs, downloads each result URL to R2 (when configured) and
 * stores the permanent URLs alongside the original temp ones. Idempotent
 * via the job's terminal-state guard at the call site.
 */
export async function persistKieJobSuccess(
  jobId: string,
  jobKind: string,
  resultJson: string | undefined,
  meta: KieSuccessMeta = {}
): Promise<void> {
  let parsed: Record<string, unknown> | null = null;
  if (resultJson) {
    try {
      const decoded = JSON.parse(resultJson);
      parsed = typeof decoded === 'object' && decoded !== null ? decoded : { raw: resultJson };
    } catch {
      parsed = { raw: resultJson };
    }
  }
  if (!parsed) parsed = {};

  if (meta.costTimeSeconds != null) {
    parsed.kieCostTimeSeconds = meta.costTimeSeconds;
  }

  if (isImageJob(jobKind)) {
    const tempUrls = Array.isArray(parsed.resultUrls)
      ? (parsed.resultUrls as unknown[]).filter((u): u is string => typeof u === 'string')
      : [];
    if (tempUrls.length > 0) {
      if (isR2Configured()) {
        // INVARIANT: a stored image URL is ALWAYS an R2 URL — never a
        // kie temp URL (tempfile.aiquickdraw.com), which 404s a few
        // days later and silently breaks the image. So we retry the
        // R2 persist, and if it STILL fails, we fail the whole job
        // (refund + regeneratable) rather than store a dying temp URL.
        const persistedUrls: string[] = [];
        for (const url of tempUrls) {
          const key = `kie/${jobId}/${randomUUID()}.png`;
          const publicUrl = await persistToR2WithRetry(url, key);
          if (!publicUrl) {
            console.error(
              `[persist-result] R2 persist failed after retries for job ${jobId} — failing it (no temp URL kept)`
            );
            // Job is still pending/running here (success update below
            // hasn't run), so persistKieJobFailure can flip + refund.
            await persistKieJobFailure(jobId, jobKind, 'r2_persist_failed', null);
            return;
          }
          persistedUrls.push(publicUrl);
        }
        parsed.persistedUrls = persistedUrls;
      } else {
        // Dev only — R2 is always configured in production, so this
        // branch never runs there. Keep temp URLs so local dev can
        // still preview the image until it expires.
        parsed.persistedUrls = tempUrls;
      }
    }
  }

  // Defense-in-depth: only flip to `completed` from a non-terminal state.
  // The kie webhook guards against this at the call site, but the watchdog
  // and any future caller could miss the check — and a late kie webhook
  // arriving after a user-cancelled job (already failed + refunded) must
  // NOT silently re-enable a job whose credits have already been refunded.
  await db
    .update(jobs)
    .set({
      status: 'completed',
      result: parsed,
      finishedAt: new Date()
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['pending', 'running'])));

  if (isImageJob(jobKind)) {
    await emitImageNotification(jobId, 'image_completed', null);
  }
}

/** Walk job → project to get userId, then log the image outcome. The
 *  user is most often NOT staring at the image grid when the kie
 *  callback fires (image generation is async ~minutes), so we leave
 *  isRead=false and let the bell badge tick up. The product title
 *  goes into the payload so the bell renders "Image générée ·
 *  Tee-shirt orange" rather than the bare job kind. */
async function emitImageNotification(
  jobId: string,
  kind: 'image_completed' | 'image_failed',
  errorMessage: string | null
): Promise<void> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { projectId: true, productId: true }
  });
  if (!job?.projectId) return;
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

  await db
    .update(jobs)
    .set({ status: 'failed', error: errorText, finishedAt: new Date() })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['pending', 'running'])));

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
async function tryImageFallback(jobId: string, jobKind: string, originalError: string): Promise<boolean> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job || (job.status !== 'pending' && job.status !== 'running')) return false;
  const input = job.inputPayload as { userPrompt?: string; sourceImageUrl?: string } | null;
  if (!input?.userPrompt) return false;
  try {
    const r = await generateFallbackImage({
      jobId,
      prompt: input.userPrompt,
      sourceImageUrl: input.sourceImageUrl ?? null
    });
    const prev = (job.result && typeof job.result === 'object' ? job.result : {}) as Record<string, unknown>;
    await db
      .update(jobs)
      .set({
        status: 'completed',
        error: null,
        finishedAt: new Date(),
        result: {
          ...prev,
          resultUrls: [],
          persistedUrls: [r.publicUrl],
          provider: 'openrouter',
          providerModel: r.model,
          providerUnitsConsumed: r.providerUnits,
          fallbackFrom: originalError.slice(0, 200)
        }
      })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['pending', 'running'])));
    console.warn(`[persist-result] image job ${jobId} rescued by fallback ${r.model} (kie: ${originalError.slice(0, 80)})`);
    await emitImageNotification(jobId, 'image_completed', null);
    return true;
  } catch (e) {
    console.error(`[persist-result] image fallback failed for job ${jobId}:`, (e as Error).message);
    return false;
  }
}
