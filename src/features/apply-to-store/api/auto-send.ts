import { and, eq, gt, inArray, or } from 'drizzle-orm';
import { db } from '@/shared/db';
import { jobs, projects } from '@/shared/db/schema';
import { approveOneGeneration } from './actions';
import { listSendableJobIds } from './send-all';

/** Stores served per pass, so one busy catalogue cannot starve the others. */
const MAX_STORES_PER_PASS = 3;
/** Generations sent per store per pass. The store's own queue drains ~300/min. */
const MAX_PER_STORE = 100;
/** How long a finished bulk run keeps sending: its last generations land after
 *  the run is marked done, and they are part of what the merchant approved. */
const BULK_TAIL_MS = 30 * 60 * 1000;

/**
 * Send completed generations for the stores that asked to skip the review step.
 *
 * A worker pass rather than a hook at job completion, for two reasons. Text,
 * images, alt texts and bulk runs all finish in different places, and this
 * covers every one of them without touching any: a generation is picked up
 * because it exists, not because someone remembered to call something. And an
 * entity cannot reach into a feature — the worker is where the two meet.
 *
 * Bounded twice over: a handful of stores per pass, a hundred generations each.
 * Whatever is left waits for the next tick, which is five seconds away.
 */
export async function autoSendCompletedGenerations(): Promise<number> {
  const enabled = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.autoApply, true))
    .limit(MAX_STORES_PER_PASS * 20);

  // A bulk run can opt in for itself without changing the store's setting.
  // Its tail counts too: the last generations land after the run is marked
  // done, and they belong to the batch the merchant said yes to.
  const runs = await db
    .select({ projectId: jobs.projectId, payload: jobs.inputPayload })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, 'bulk_site_generate'),
        or(
          inArray(jobs.status, ['pending', 'running']),
          gt(jobs.createdAt, new Date(Date.now() - BULK_TAIL_MS))
        )
      )
    )
    .limit(MAX_STORES_PER_PASS * 20);

  const byProject = new Map(enabled.map((p) => [p.id, p.userId]));
  for (const run of runs) {
    if (!run.projectId || byProject.has(run.projectId)) continue;
    if (!(run.payload as { autoSend?: boolean } | null)?.autoSend) continue;
    const owner = await db.query.projects.findFirst({
      where: eq(projects.id, run.projectId),
      columns: { userId: true }
    });
    if (owner) byProject.set(run.projectId, owner.userId);
  }
  const targets = [...byProject].map(([id, userId]) => ({ id, userId }));
  if (targets.length === 0) return 0;

  let sent = 0;
  let served = 0;
  for (const project of targets) {
    if (served >= MAX_STORES_PER_PASS) break;
    const owner = await db.query.users.findFirst({
      where: (u, { eq: is }) => is(u.id, project.userId),
      columns: { plan: true }
    });
    const jobIds = (await listSendableJobIds(project.id)).slice(0, MAX_PER_STORE);
    if (jobIds.length === 0) continue;
    served += 1;
    for (const jobId of jobIds) {
      const res = await approveOneGeneration(project.userId, owner?.plan ?? 'free', jobId);
      if (res.ok) sent += 1;
    }
  }
  if (sent > 0) console.info(`[auto-send] queued ${sent} change(s)`);
  return sent;
}

/** Turn it on or off for one store. Owner only. */
export async function setAutoApply(
  projectId: string,
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const res = await db
    .update(projects)
    .set({ autoApply: enabled })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return res[0].affectedRows > 0;
}
