import { and, eq, inArray, lt } from 'drizzle-orm';
import { IMAGE_RETENTION_DAYS } from '@/lib/ai/models';
import { db } from '@/lib/db';
import { jobs, type JobKind } from '@/lib/db/schema';
import { deleteByKey, keyFromPublicUrl } from '@/lib/storage';

/**
 * Generated AI images live in R2 for IMAGE_RETENTION_DAYS days (30). After
 * that the worker drops the corresponding R2 objects AND the jobs row, so
 * a merchant returning to the optim page sees the section as if no
 * generation ever happened (the UI keys off the absence of completed
 * image jobs).
 *
 * The cron is hourly: hits the same query on every run, but the work is
 * only meaningful for jobs that crossed the boundary since the previous
 * tick. R2 DeleteObject is idempotent so re-running on a job that's
 * already been cleaned is a no-op (just a 404 we swallow).
 */
const RETENTION_MS = IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const IMAGE_KINDS: JobKind[] = ['kie_image_edit', 'kie_image_generate'];

interface ImageResultShape {
  persistedUrls?: string[];
  resultUrls?: string[];
}

export async function runR2Cleanup(): Promise<{ deleted: number; r2Objects: number }> {
  const cutoff = new Date(Date.now() - RETENTION_MS);

  const expired = await db.query.jobs.findMany({
    where: and(inArray(jobs.kind, IMAGE_KINDS), lt(jobs.createdAt, cutoff)),
    limit: 200
  });

  if (expired.length === 0) return { deleted: 0, r2Objects: 0 };

  let r2Objects = 0;
  let deletedRows = 0;

  for (const job of expired) {
    const result = (job.result ?? null) as ImageResultShape | null;
    // Best effort: drop our R2 copies first. Failures don't block the DB
    // delete — leftover objects are an operational nuisance but not a
    // correctness bug, and a Cloudflare bucket lifecycle rule can be set
    // up as belt-and-braces.
    const urls = result?.persistedUrls ?? [];
    for (const url of urls) {
      const key = keyFromPublicUrl(url);
      if (!key) continue;
      const ok = await deleteByKey(key);
      if (ok) r2Objects += 1;
    }

    await db.delete(jobs).where(eq(jobs.id, job.id));
    deletedRows += 1;
  }

  console.log(
    `[r2-cleanup] cutoff=${cutoff.toISOString()} jobs_deleted=${deletedRows} r2_objects_deleted=${r2Objects}`
  );

  return { deleted: deletedRows, r2Objects };
}
