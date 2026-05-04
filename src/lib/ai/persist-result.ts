import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction } from '@/lib/credits';
import { db } from '@/lib/db';
import { jobs, projects, type JobKind } from '@/lib/db/schema';
import { isR2Configured, uploadFromUrl } from '@/lib/storage';

const IMAGE_KINDS: JobKind[] = ['kie_image_edit', 'kie_image_generate'];

function isImageJob(kind: string): boolean {
  return (IMAGE_KINDS as string[]).includes(kind);
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
      const persistedUrls: string[] = [];
      if (isR2Configured()) {
        for (const url of tempUrls) {
          try {
            const key = `kie/${jobId}/${randomUUID()}.png`;
            const r = await uploadFromUrl(url, key);
            persistedUrls.push(r.publicUrl);
          } catch (e) {
            console.error(
              `[persist-result] R2 upload failed for job ${jobId}, keeping temp URL`,
              e
            );
            persistedUrls.push(url);
          }
        }
      } else {
        // Dev / no R2 — keep temp URLs. They expire but are usable until they do.
        persistedUrls.push(...tempUrls);
      }
      parsed.persistedUrls = persistedUrls;
    }
  }

  await db
    .update(jobs)
    .set({
      status: 'completed',
      result: parsed,
      finishedAt: new Date()
    })
    .where(eq(jobs.id, jobId));
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

  await db
    .update(jobs)
    .set({ status: 'failed', error: errorText, finishedAt: new Date() })
    .where(eq(jobs.id, jobId));

  if (!isImageJob(jobKind)) return;

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job?.projectId || job.creditsCost <= 0) return;

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
}
