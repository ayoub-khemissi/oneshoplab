import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { notifications, type NotificationKind } from './db/schema';

/**
 * Server-side helper to log a generation outcome to the per-user
 * notification stream surfaced by the header bell.
 *
 * `isRead` defaults to false because most call sites (image worker,
 * audit pipeline) run AFTER the user has navigated away. The chat
 * flow runs synchronously while the user is on the product page and
 * is guaranteed to see the toast — those call sites pass
 * `isRead: true` so the badge doesn't tick up for events the user
 * just acknowledged.
 *
 * Safe to call from any path that has a userId. Returns the new id
 * so the caller can correlate later (e.g. the chat API returns it in
 * its response so the client can mark-read on toast dismiss).
 */
export interface NotificationInput {
  userId: string;
  kind: NotificationKind;
  /** Set true only if the originating event also produced a foreground
   *  toast the user was guaranteed to see. */
  isRead?: boolean;
  jobId?: string | null;
  auditId?: string | null;
  productId?: string | null;
  projectId?: string | null;
  payload?: Record<string, unknown> | null;
}

export async function notify(input: NotificationInput): Promise<string> {
  const id = randomUUID();
  await db.insert(notifications).values({
    id,
    userId: input.userId,
    kind: input.kind,
    jobId: input.jobId ?? null,
    auditId: input.auditId ?? null,
    productId: input.productId ?? null,
    projectId: input.projectId ?? null,
    payload: input.payload ?? null,
    isRead: input.isRead ?? false
  });
  return id;
}

/** Mark every unread notification for `userId` as read. Fires when the
 *  merchant clicks the bell icon. */
export async function markAllRead(userId: string): Promise<{ updated: number }> {
  const r = await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return { updated: (r as unknown as { rowsAffected?: number }).rowsAffected ?? 0 };
}

/** Mark every unread notification linked to a given jobId as read.
 *  Called by the client right after firing a toast for that job, so
 *  the badge doesn't double up on the same event. */
export async function markReadByJob(
  userId: string,
  jobId: string
): Promise<{ updated: number }> {
  const r = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.jobId, jobId),
        eq(notifications.isRead, false)
      )
    );
  return { updated: (r as unknown as { rowsAffected?: number }).rowsAffected ?? 0 };
}

/** Same as markReadByJob but keyed on auditId (audit_completed /
 *  audit_failed don't have a jobId). */
export async function markReadByAudit(
  userId: string,
  auditId: string
): Promise<{ updated: number }> {
  const r = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.auditId, auditId),
        eq(notifications.isRead, false)
      )
    );
  return { updated: (r as unknown as { rowsAffected?: number }).rowsAffected ?? 0 };
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  jobId: string | null;
  auditId: string | null;
  productId: string | null;
  projectId: string | null;
  payload: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: Date;
}

/** Read the N most recent notifications for the bell dropdown, plus
 *  the current unread count for the badge. Capped at 50 — the bell
 *  isn't an archive UI. */
export async function listForBell(
  userId: string,
  limit = 30
): Promise<{ rows: NotificationRow[]; unreadCount: number }> {
  const cap = Math.max(1, Math.min(50, limit));
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      jobId: notifications.jobId,
      auditId: notifications.auditId,
      productId: notifications.productId,
      projectId: notifications.projectId,
      payload: notifications.payload,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(cap);
  // Cheaper to count unread off the same scan than to re-query; the
  // bell only ever needs the page-1 unread count for the badge.
  let unreadCount = 0;
  const out: NotificationRow[] = [];
  for (const r of rows) {
    out.push({
      ...r,
      payload: (r.payload as Record<string, unknown> | null) ?? null
    });
    if (!r.isRead) unreadCount += 1;
  }
  // If the limit is hit AND there could be more unread beyond the
  // window, fall back to an explicit count so the badge stays
  // accurate at high volumes.
  if (rows.length >= cap) {
    const all = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    unreadCount = all.length;
  }
  return { rows: out, unreadCount };
}

/** Resolve the userId that owns a list of jobIds — useful for image
 *  worker hooks where we have the job but not the user yet. Returns
 *  one row per (jobId, userId) so callers can fan out the notify
 *  call. */
export async function userIdsForJobs(jobIds: string[]): Promise<Map<string, string>> {
  if (jobIds.length === 0) return new Map();
  // Resolve via projects.userId — every job ties to a project, every
  // project to a user.
  const { jobs, projects } = await import('./db/schema');
  const rows = await db
    .select({ jobId: jobs.id, userId: projects.userId })
    .from(jobs)
    .innerJoin(projects, eq(projects.id, jobs.projectId))
    .where(inArray(jobs.id, jobIds));
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.jobId, r.userId);
  return m;
}
