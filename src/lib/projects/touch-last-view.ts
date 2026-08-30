import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

/**
 * Stamp `projects.lastViewedAt` for the signed-in owner. Lives outside
 * auth-actions so features/run-audit can use it without importing the server-actions
 * module (which itself imports features/run-audit → circular).
 */
export async function touchProjectLastView(projectId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  await db
    .update(projects)
    .set({ lastViewedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)));
}
