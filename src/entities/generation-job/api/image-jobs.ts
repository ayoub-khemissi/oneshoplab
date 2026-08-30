import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import type { ImageJobRow } from '../model/types';

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
      isNull(jobs.hiddenAt),
      // Retention-expired generations (r2-cleanup stamped expiredAt and
      // dropped the R2 object) have nothing to show and no action to
      // offer — the merchant already applied them to the product if they
      // wanted them. Showing them rendered as red "failed" tiles with no
      // buttons (bug reported 2026-08-29).
      isNull(jobs.expiredAt)
    ),
    orderBy: [desc(jobs.createdAt)],
    limit: 50
  });

  // We can't filter on a JSON path with Drizzle's MySQL driver here, so
  // we narrow client-side. 50 rows is plenty given the per-product cap.
  return rows
    .filter((r) => {
      const input = r.inputPayload as { productSourceId?: string } | null;
      if (input?.productSourceId !== productSourceId) return false;
      // Legacy rows completed before R2 persistence existed (or whose
      // image was purged without an expiredAt stamp) carry no URL — same
      // treatment as expired: nothing to render, nothing to act on.
      if (r.status === 'completed') {
        const result = r.result as { persistedUrls?: string[] } | null;
        return Boolean(result?.persistedUrls?.[0]);
      }
      return true;
    })
    .map(toImageJobRow)
    .reverse();
}

function toImageJobRow(r: typeof jobs.$inferSelect): ImageJobRow {
  const input = r.inputPayload as { userPrompt?: string; sourceImageUrl?: string } | null;
  const result = r.result as { persistedUrls?: string[]; resultUrls?: string[] } | null;
  // Only ever surface the persisted (R2) URL — never the raw kie
  // resultUrls, which are temp (tempfile.aiquickdraw.com) and 404
  // after a few days. A completed job always has persistedUrls
  // (persist-result fails the job otherwise), so a missing one means
  // legacy/broken data → show nothing rather than a dead temp link.
  const url = result?.persistedUrls?.[0] ?? null;
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
