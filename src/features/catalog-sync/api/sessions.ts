/**
 * `mode: "full"` sessions (spec §3): opened by the first page, fed by
 * every page, closed by the page with `final: true`. A session that never
 * gets `final` expires (30 min) without archiving anything.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { ApiError } from '@/shared/api';
import { db } from '@/shared/db';
import { catalogSyncSessions } from '@/shared/db/schema';

export const SYNC_SESSION_TTL_MS = 30 * 60 * 1000;

export type SyncSessionRow = typeof catalogSyncSessions.$inferSelect;

async function openSession(projectId: string, now: Date): Promise<SyncSessionRow | null> {
  const [row] = await db
    .select()
    .from(catalogSyncSessions)
    .where(
      and(
        eq(catalogSyncSessions.projectId, projectId),
        isNull(catalogSyncSessions.closedAt),
        gt(catalogSyncSessions.expiresAt, now)
      )
    );
  return row ?? null;
}

/** No `session` in the body: open one, or 409 when another is still open. */
export async function startSession(projectId: string, now = new Date()): Promise<SyncSessionRow> {
  const open = await openSession(projectId, now);
  if (open) {
    throw new ApiError('sync_in_progress', 'A full sync session is already open', 409, {
      session: open.id,
      expiresAt: open.expiresAt.toISOString()
    });
  }
  const id = randomUUID();
  await db.insert(catalogSyncSessions).values({
    id,
    projectId,
    seenSourceIds: [],
    expiresAt: new Date(now.getTime() + SYNC_SESSION_TTL_MS)
  });
  const [row] = await db.select().from(catalogSyncSessions).where(eq(catalogSyncSessions.id, id));
  return row;
}

/** `session` in the body: must belong to the project, be open and unexpired. */
export async function resumeSession(
  projectId: string,
  sessionId: string,
  now = new Date()
): Promise<SyncSessionRow> {
  const [row] = await db
    .select()
    .from(catalogSyncSessions)
    .where(
      and(eq(catalogSyncSessions.id, sessionId), eq(catalogSyncSessions.projectId, projectId))
    );
  if (!row || row.closedAt || row.expiresAt.getTime() <= now.getTime()) {
    throw new ApiError('validation', 'Unknown, closed or expired sync session', 422, {
      session: sessionId
    });
  }
  return row;
}

export async function addSeenSourceIds(
  session: SyncSessionRow,
  sourceIds: readonly string[]
): Promise<string[]> {
  const seen = Array.from(new Set([...session.seenSourceIds, ...sourceIds]));
  await db
    .update(catalogSyncSessions)
    .set({ seenSourceIds: seen })
    .where(eq(catalogSyncSessions.id, session.id));
  return seen;
}

export async function closeSession(sessionId: string, now = new Date()): Promise<void> {
  await db
    .update(catalogSyncSessions)
    .set({ closedAt: now })
    .where(eq(catalogSyncSessions.id, sessionId));
}
