import { and, desc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '@/shared/db';
import { audits } from '@/shared/db/schema';

/**
 * Why these helpers exist.
 *
 * `audits.summary` is a JSON blob that can reach several MB on a
 * large catalog. Any query that projects the full row AND orders by
 * `created_at` forces MySQL to spill the result set (including
 * `summary`) into its sort buffer; on the OVH box that triggers
 *
 *     "Out of sort memory, consider increasing server sort buffer size"
 *
 * and the request 500s. The fix is to never sort the full row: pick
 * the candidate id with a tiny projection first, then fetch by
 * primary key (no sort) with whatever columns the caller actually
 * needs.
 *
 * These helpers wrap that two-step pattern so individual call sites
 * stay readable.
 */

/**
 * Tiny projection — just `audits.id` — sorted by `created_at DESC`.
 * Use whenever a caller wants "the most recent audit matching X" and
 * couldn't care less about the row's content yet.
 */
export async function findLatestAuditIdWhere(whereExpr: SQL): Promise<string | null> {
  const rows = await db
    .select({ id: audits.id })
    .from(audits)
    .where(whereExpr)
    .orderBy(desc(audits.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Full row of the latest audit matching the where clause. Two-step:
 * first the id (cheap sort), then a primary-key lookup for the
 * complete row.
 */
export async function findLatestAuditFull(
  whereExpr: SQL
): Promise<typeof audits.$inferSelect | null> {
  const id = await findLatestAuditIdWhere(whereExpr);
  if (!id) return null;
  const row = await db.query.audits.findFirst({ where: eq(audits.id, id) });
  return row ?? null;
}

/**
 * A project's audits, plus the legacy `(projectId IS NULL AND domain = …)`
 * leg used for rows inserted before the projects ↔ audits FK was wired up.
 */
function projectAuditsWhere(projectId: string, domain: string | null): SQL {
  return or(
    eq(audits.projectId, projectId),
    and(isNull(audits.projectId), eq(audits.domain, domain ?? ''))
  )!;
}

/**
 * Convenience for the dashboard / product pages: pick the latest
 * audit attached to a project (see `projectAuditsWhere`).
 */
export async function findLatestAuditForProject(
  projectId: string,
  domain: string | null
): Promise<typeof audits.$inferSelect | null> {
  return findLatestAuditFull(projectAuditsWhere(projectId, domain));
}

/** Which audit is the latest, and which version of its content. */
export interface AuditStamp {
  id: string;
  status: (typeof audits.$inferSelect)['status'];
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * The latest audit of a project as a stamp — small columns only, never the
 * summary — for callers that cache what they derive from the summary and need
 * to know when to derive it again. Not just the id: a re-score rewrites the
 * summary of the same row in place (bumping `completedAt`), a manual
 * recompute bumps `startedAt`, and a running audit completes.
 */
export async function findLatestAuditStampForProject(
  projectId: string,
  domain: string | null
): Promise<AuditStamp | null> {
  const rows = await db
    .select({
      id: audits.id,
      status: audits.status,
      startedAt: audits.startedAt,
      completedAt: audits.completedAt
    })
    .from(audits)
    .where(projectAuditsWhere(projectId, domain))
    .orderBy(desc(audits.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
