import { and, eq } from 'drizzle-orm';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';
import { approveOneGeneration } from './actions';
import { listSendableJobIds } from './send-all';

/** Stores served per pass, so one busy catalogue cannot starve the others. */
const MAX_STORES_PER_PASS = 3;
/** Generations sent per store per pass. The store's own queue drains ~300/min. */
const MAX_PER_STORE = 100;

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
  if (enabled.length === 0) return 0;

  let sent = 0;
  let served = 0;
  for (const project of enabled) {
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
