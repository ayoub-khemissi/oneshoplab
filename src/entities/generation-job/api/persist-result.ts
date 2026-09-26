import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/shared/db';
import { jobs, projects } from '@/shared/db/schema';
import { transitionJob } from './transitions';
import { emitImageNotification, isImageJob, persistKieJobFailure } from './job-failure';
import { startRemoveBackground } from './remove-background';
import { isR2Configured, uploadBuffer, uploadFromUrl } from '@/shared/storage';
import { toTransparentPng } from '../lib/transparent-png';

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

/**
 * Background-removal results are normalised before they are stored: RGBA PNG
 * whatever container kie answered with, alpha snapped to fully opaque on the
 * subject. Same retry policy as the plain copy, same "temp URL never stored"
 * rule. In memory end to end — no tempfile.
 */
async function persistTransparentPngWithRetry(
  sourceUrl: string,
  key: string,
  attempts = 4
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
      const input = Buffer.from(await res.arrayBuffer());
      const out = await toTransparentPng(input);
      if (out.transparentRatio === 0) {
        // The tool found nothing to remove: storing an opaque copy would sell
        // the merchant a "transparent" image that is not. Fail → refund.
        throw new NoBackgroundRemovedError();
      }
      const r = await uploadBuffer(out.png, key, 'image/png');
      return r.publicUrl;
    } catch (e) {
      if (e instanceof NoBackgroundRemovedError) throw e;
      const last = i === attempts - 1;
      console.error(
        `[persist-result] transparent PNG attempt ${i + 1}/${attempts} failed for ${key}${last ? ' (giving up)' : ''}`,
        (e as Error).message
      );
      if (last) return null;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  return null;
}

class NoBackgroundRemovedError extends Error {
  constructor() {
    super('no_background_removed');
  }
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

  // A cut-out (op = remove_bg) is stored as a normalised transparent PNG and
  // inherits its source's alt; a generation is copied byte for byte.
  const jobRow = isImageJob(jobKind)
    ? await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), columns: { inputPayload: true } })
    : null;
  const input = (jobRow?.inputPayload ?? null) as {
    op?: string;
    sourceAlt?: string;
    thenRemoveBg?: boolean;
  } | null;
  const isCutout = input?.op === 'remove_bg';

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
          let publicUrl: string | null;
          if (isCutout) {
            try {
              publicUrl = await persistTransparentPngWithRetry(url, key);
            } catch (e) {
              if (e instanceof NoBackgroundRemovedError) {
                await persistKieJobFailure(
                  jobId,
                  jobKind,
                  'no_background_removed',
                  'fallback_failed'
                );
                return;
              }
              throw e;
            }
          } else {
            publicUrl = await persistToR2WithRetry(url, key);
          }
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
        if (isCutout && input?.sourceAlt) parsed.alts = [input.sourceAlt];
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
  const r = await transitionJob(db, jobId, 'completed', { result: parsed }, { tolerate: true });
  if (r === 'refused') {
    console.warn(`[persist-result] job ${jobId}: → completed refused (already terminal)`);
    return;
  }

  if (isImageJob(jobKind)) {
    await emitImageNotification(jobId, 'image_completed', null);
    if (input?.thenRemoveBg && !isCutout) {
      await chainRemoveBackground(jobId, parsed);
    }
  }
}

/**
 * The merchant asked for a transparent version of the picture they were
 * generating: queue it now that the source exists. Billed at this point, so
 * a balance that has meanwhile run dry means no cut-out and no debit — the
 * generation itself is untouched.
 */
async function chainRemoveBackground(
  jobId: string,
  result: Record<string, unknown>
): Promise<void> {
  const url = Array.isArray(result.persistedUrls) ? (result.persistedUrls[0] as string) : null;
  if (!url) return;
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { projectId: true, inputPayload: true }
  });
  if (!job?.projectId) return;
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, job.projectId),
    columns: { userId: true }
  });
  const input = job.inputPayload as { productSourceId?: string; silent?: boolean } | null;
  if (!project?.userId || !input?.productSourceId) return;
  try {
    await startRemoveBackground({
      userId: project.userId,
      projectId: job.projectId,
      productSourceId: input.productSourceId,
      sourceImageUrl: url,
      sourceJobId: jobId,
      sourceAlt: Array.isArray(result.alts) ? ((result.alts[0] as string) ?? null) : null,
      appUrl: process.env.APP_URL,
      silent: input.silent
    });
  } catch (e) {
    console.warn(
      `[persist-result] chained remove_bg skipped for job ${jobId}:`,
      (e as Error).message
    );
  }
}
