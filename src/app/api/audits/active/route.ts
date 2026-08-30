import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { auth } from '@/entities/user';
import { db } from '@/lib/db';
import { audits, projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

const RECENT_WINDOW_MS = 30 * 60 * 1000;

// Snapshot of the current user's recent audits so the client-side
// AuditToastWatcher can detect status transitions and toast on completion.
// Returns [] for unauthenticated visitors so the watcher can poll harmlessly
// from any page in the app.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json([]);

  const userId = session.user.id;

  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    columns: { id: true, name: true, domain: true }
  });
  if (userProjects.length === 0) return NextResponse.json([]);

  const projectIds = userProjects.map((p) => p.id);
  const projectById = new Map(userProjects.map((p) => [p.id, p]));
  const since = new Date(Date.now() - RECENT_WINDOW_MS);

  const recent = await db.query.audits.findMany({
    where: and(
      isNotNull(audits.projectId),
      inArray(audits.projectId, projectIds),
      gte(audits.createdAt, since)
    ),
    orderBy: [desc(audits.createdAt)],
    limit: 20,
    columns: { id: true, status: true, projectId: true }
  });

  return NextResponse.json(
    recent.map((a) => {
      const project = a.projectId ? projectById.get(a.projectId) : null;
      return {
        id: a.id,
        status: a.status,
        projectId: a.projectId,
        projectName: project?.name ?? project?.domain ?? null
      };
    })
  );
}
