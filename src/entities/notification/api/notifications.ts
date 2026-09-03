import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import { isPushConfigured, sendPushToUser } from '@/entities/push-subscription';
import { db } from '@/shared/db';
import { legalConsents, notifications, type NotificationKind } from '@/shared/db/schema';
import { pushPayloadFor } from '../lib/notification-push';

/** Per-user retention cap. We keep the 20 most recent notifications
 *  and trim older rows on every insert — the bell isn't an archive,
 *  it's a "what happened lately" surface, and unbounded growth would
 *  bloat the read path indefinitely. 20 is enough for a day of
 *  active generation work without forcing the merchant to mark-read
 *  to clear visual clutter. */
const KEEP_PER_USER = 20;

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
  await trimOldest(input.userId);
  // The same notice, on the merchant's phone. Best-effort and un-awaited: the
  // row is already in the bell, and a push service being slow or down must
  // never hold up the generation that triggered it. A notice the merchant was
  // guaranteed to see as a toast (`isRead`) is not pushed — they are looking
  // at it.
  if (!input.isRead) void mirrorToPush(input).catch(() => undefined);
  return id;
}

/** Locale of the account, as last signed on a consent — English otherwise. */
async function localeOf(userId: string): Promise<string | null> {
  const [consent] = await db
    .select({ locale: legalConsents.locale })
    .from(legalConsents)
    .where(and(eq(legalConsents.userId, userId), isNotNull(legalConsents.locale)))
    .orderBy(desc(legalConsents.acceptedAt))
    .limit(1);
  return consent?.locale ?? null;
}

async function mirrorToPush(input: NotificationInput): Promise<void> {
  if (!isPushConfigured()) return;
  const appUrl = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');
  const payload = await pushPayloadFor(
    {
      kind: input.kind,
      projectId: input.projectId ?? null,
      productId: input.productId ?? null,
      auditId: input.auditId ?? null,
      payload: input.payload ?? null
    },
    await localeOf(input.userId),
    appUrl
  );
  await sendPushToUser(input.userId, payload);
}

/** Drop everything past the KEEP_PER_USER cap. Runs after every
 *  insert, so the user's row count stays bounded over time without
 *  needing a cron sweep. Two-step (select keep-ids → delete the
 *  complement) because MySQL can't reference the same table in a
 *  DELETE subquery directly. On the steady state (already ≤ cap),
 *  the delete is a no-op against an empty `notInArray` set, which
 *  drizzle short-circuits. */
async function trimOldest(userId: string): Promise<void> {
  const keep = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(KEEP_PER_USER);
  // No work to do if we're under the cap.
  if (keep.length < KEEP_PER_USER) return;
  await db.delete(notifications).where(
    and(
      eq(notifications.userId, userId),
      notInArray(
        notifications.id,
        keep.map((r) => r.id)
      )
    )
  );
}

/** Mark every unread notification for `userId` as read. Fires when the
 *  merchant clicks the bell icon. */
export async function markAllRead(userId: string): Promise<{ updated: number }> {
  const r = await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return { updated: r[0].affectedRows };
}

/** Mark every unread notification linked to a given jobId as read.
 *  Called by the client right after firing a toast for that job, so
 *  the badge doesn't double up on the same event. */
export async function markReadByJob(userId: string, jobId: string): Promise<{ updated: number }> {
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
  return { updated: r[0].affectedRows };
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
  return { updated: r[0].affectedRows };
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

/** Read the most recent notifications for the bell dropdown, plus
 *  the current unread count for the badge. Capped at KEEP_PER_USER
 *  because the trim policy guarantees no user holds more than that. */
export async function listForBell(
  userId: string,
  limit = KEEP_PER_USER
): Promise<{ rows: NotificationRow[]; unreadCount: number }> {
  const cap = Math.max(1, Math.min(KEEP_PER_USER, limit));
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
  // Count unread off the same scan — the trim policy means there
  // are never more notifs than `cap`, so we never miss any.
  let unreadCount = 0;
  const out: NotificationRow[] = [];
  for (const r of rows) {
    out.push({
      ...r,
      payload: (r.payload as Record<string, unknown> | null) ?? null
    });
    if (!r.isRead) unreadCount += 1;
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
  const { jobs, projects } = await import('@/shared/db/schema');
  const rows = await db
    .select({ jobId: jobs.id, userId: projects.userId })
    .from(jobs)
    .innerJoin(projects, eq(projects.id, jobs.projectId))
    .where(inArray(jobs.id, jobIds));
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.jobId, r.userId);
  return m;
}
