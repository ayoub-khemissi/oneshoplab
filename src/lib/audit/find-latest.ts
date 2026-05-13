import { and, desc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits } from '@/lib/db/schema';

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
export async function findLatestAuditIdWhere(
  whereExpr: SQL
): Promise<string | null> {
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
 * Convenience for the dashboard / product pages: pick the latest
 * audit attached to a project, falling back to the legacy
 * `(projectId IS NULL AND domain = …)` leg used for rows inserted
 * before the projects ↔ audits FK was wired up.
 */
export async function findLatestAuditForProject(
  projectId: string,
  domain: string | null
): Promise<typeof audits.$inferSelect | null> {
  return findLatestAuditFull(
    or(
      eq(audits.projectId, projectId),
      and(isNull(audits.projectId), eq(audits.domain, domain ?? ''))
    )!
  );
}
