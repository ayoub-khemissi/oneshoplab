import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import type { ImageJobRow } from './image-jobs-types';

export type { ImageJobRow } from './image-jobs-types';
export { MAX_IMAGES_PER_PRODUCT } from './image-jobs-types';

/**
 * List the image jobs the merchant should currently see for one product —
 * i.e. every kie_image_edit job that's not soft-hidden, regardless of
 * status. This is the source of truth for the in-product AI image grid:
 * pending/running show skeletons, completed show the image, failed show
 * an error tile. Order is oldest-first so the grid is stable across
 * regenerations (a regenerate hides the old, the new lands at the end).
 */
export async function listProductImageJobs(
  projectId: string,
  productSourceId: string
): Promise<ImageJobRow[]> {
  const rows = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, 'kie_image_edit'),
      isNull(jobs.hiddenAt)
    ),
    orderBy: [desc(jobs.createdAt)],
    limit: 50
  });

  // We can't filter on a JSON path with Drizzle's MySQL driver here, so
  // we narrow client-side. 50 rows is plenty given the per-product cap.
  return rows
    .filter((r) => {
      const input = r.inputPayload as { productSourceId?: string } | null;
      return input?.productSourceId === productSourceId;
    })
    .map(toImageJobRow)
    .reverse();
}

function toImageJobRow(r: typeof jobs.$inferSelect): ImageJobRow {
  const input = r.inputPayload as
    | { userPrompt?: string; sourceImageUrl?: string }
    | null;
  const result = r.result as
    | { persistedUrls?: string[]; resultUrls?: string[] }
    | null;
  const url =
    result?.persistedUrls?.[0] ??
    result?.resultUrls?.[0] ??
    null;
  return {
    id: r.id,
    status: r.status,
    kieTaskId: r.kieTaskId ?? null,
    imageUrl: url,
    sourceImageUrl: input?.sourceImageUrl ?? null,
    prompt: input?.userPrompt ?? '',
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    error: r.error ?? null,
    creditsCost: r.creditsCost
  };
}

