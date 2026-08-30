import { and, eq, inArray, isNull, lt, notInArray } from 'drizzle-orm';
import { imageRetentionDaysForPlan, MAX_IMAGE_RETENTION_DAYS } from '@/entities/ai-model';
import { db } from '@/lib/db';
import { jobs, projects, shareLinks, users, type JobKind } from '@/lib/db/schema';
import { deleteByKey, keyFromPublicUrl } from '@/lib/storage';

/**
 * Generated AI images live in R2 for a per-plan retention window
 * (Free/Starter 30d, Pro 60d, Scale 90d — see imageRetentionDaysForPlan).
 *
 * When the merchant's window crosses, the worker:
 *   1. Deletes the R2 objects (frees storage).
 *   2. Clears `persistedUrls` / `resultUrls` on the jobs row so the
 *      UI knows there's nothing to render anymore.
 *   3. Stamps `expiredAt` on the row — the row STAYS (history, showcase,
 *      ledger) but listProductImageJobs excludes expired rows so the
 *      past-generations history keeps a tombstone explaining when each
 *      image expired (live grid already filters on hiddenAt to hide
 *      these from the active workspace).
 *
 * The cron is hourly: it walks any non-yet-expired image job older
 * than the *longest* retention window (i.e. Scale's 90d), then
 * per-row checks the actual owning plan to decide whether the job
 * has crossed the merchant's personal cutoff. The `isNull(expiredAt)`
 * filter is what keeps the candidate set bounded once we stopped
 * deleting rows — otherwise every hourly tick would re-walk every
 * historical image job forever.
 *
 * R2 DeleteObject is idempotent so a stale candidate that was
 * partially processed last tick is fine: we re-delete the (already
 * gone) objects and stamp expiredAt.
 */
const MAX_RETENTION_MS = MAX_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const IMAGE_KINDS: JobKind[] = ['kie_image_edit', 'kie_image_generate'];

interface ImageResultShape {
  persistedUrls?: string[];
  resultUrls?: string[];
}

export async function runR2Cleanup(): Promise<{ deleted: number; r2Objects: number }> {
  // Outer bound: anything older than the longest plan's window can't
  // legitimately still be in retention for any user. Anything fresher
  // than this is left to a future tick (we re-check the per-plan cutoff
  // below before actually deleting).
  const outerCutoff = new Date(Date.now() - MAX_RETENTION_MS);

  // Projects featured on the home showcase (active, non-revoked share
  // link with showOnHome) must NEVER have their images expire —
  // otherwise the public before/after strip on the landing page (and
  // the /share/[token] page) would render broken tiles. We exclude
  // them at QUERY time rather than skipping in the loop so their
  // never-tombstoned rows can't accumulate and starve the bounded
  // candidate set. Admin curates a handful, so the extra retained
  // storage is negligible vs. a broken homepage.
  const showcaseRows = await db
    .select({ projectId: shareLinks.projectId })
    .from(shareLinks)
    .where(and(eq(shareLinks.showOnHome, true), isNull(shareLinks.revokedAt)));
  const showcaseProjectIds = Array.from(new Set(showcaseRows.map((r) => r.projectId)));

  // We can't filter by per-plan retention at query time without joining
  // through projects/users — Drizzle's MySQL driver wants a flat where.
  // Pull a small superset (oldest first) and narrow client-side. The
  // outer cutoff already weeds out anything within the longest plan
  // window so the candidate set is bounded.
  const candidates = await db.query.jobs.findMany({
    where: and(
      inArray(jobs.kind, IMAGE_KINDS),
      lt(jobs.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      // Skip rows already expired by a previous tick — we don't delete
      // rows anymore, we tombstone them, and without this filter the
      // worker would re-process them every hour forever.
      isNull(jobs.expiredAt),
      // Exclude showcase projects (guarded: notInArray on an empty set
      // would be a no-op we'd rather not emit).
      showcaseProjectIds.length ? notInArray(jobs.projectId, showcaseProjectIds) : undefined
    ),
    orderBy: (j, { asc }) => [asc(j.createdAt)],
    limit: 200
  });

  if (candidates.length === 0) return { deleted: 0, r2Objects: 0 };

  // Pre-load the (project → user → plan) hop in a single pass instead
  // of issuing N+1 queries inside the loop.
  const projectIds = Array.from(
    new Set(candidates.map((c) => c.projectId).filter((id): id is string => Boolean(id)))
  );
  const projectRows = projectIds.length
    ? await db.query.projects.findMany({
        where: inArray(projects.id, projectIds)
      })
    : [];
  const userIds = Array.from(new Set(projectRows.map((p) => p.userId)));
  const userRows = userIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, userIds) })
    : [];

  const userPlanById = new Map(userRows.map((u) => [u.id, u.plan ?? 'free']));
  const userIdByProject = new Map(projectRows.map((p) => [p.id, p.userId]));

  let r2Objects = 0;
  let deletedRows = 0;

  for (const job of candidates) {
    // Resolve the owning plan; default to 'free' (shortest window) when
    // the chain is broken (orphan project / deleted user).
    const userId = job.projectId ? userIdByProject.get(job.projectId) : null;
    const plan = userId ? (userPlanById.get(userId) ?? 'free') : 'free';
    const retentionMs = imageRetentionDaysForPlan(plan) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;
    if (job.createdAt.getTime() >= cutoff) {
      // Still within the merchant's personal window — leave alone.
      continue;
    }

    const result = (job.result ?? null) as ImageResultShape | null;
    const urls = result?.persistedUrls ?? [];
    for (const url of urls) {
      const key = keyFromPublicUrl(url);
      if (!key) continue;
      const ok = await deleteByKey(key);
      if (ok) r2Objects += 1;
    }

    // Tombstone the row: keep it (for the past-generations history
    // tombstone), but clear the URLs so the UI knows the image is
    // gone, and stamp expiredAt so future cron ticks skip it.
    await db
      .update(jobs)
      .set({
        result: {
          ...(result ?? {}),
          persistedUrls: [],
          resultUrls: []
        },
        expiredAt: new Date()
      })
      .where(eq(jobs.id, job.id));
    deletedRows += 1;
  }

  // Reference outerCutoff so the constant isn't optimized away — it's
  // here for documentation and a future query-side optimisation.
  void outerCutoff;

  console.log(
    `[r2-cleanup] candidates=${candidates.length} jobs_deleted=${deletedRows} r2_objects_deleted=${r2Objects} showcase_excluded=${showcaseProjectIds.length}`
  );

  return { deleted: deletedRows, r2Objects };
}
