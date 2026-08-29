import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { audits, projects } from './db/schema';

const COOKIE_NAME = 'oneshoplab_anon';
const MAX_AGE_DAYS = 30;

export async function getAnonToken(): Promise<string | null> {
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value ?? null;
}

/** Read or create the anonymous-visitor cookie. Returns the token. */
export async function ensureAnonToken(): Promise<string> {
  const c = await cookies();
  const existing = c.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const token = randomUUID();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * MAX_AGE_DAYS,
    path: '/'
  });
  return token;
}

export async function clearAnonToken(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

/**
 * On signup: convert a *specific* anonymous audit (looked up by its
 * URL token) into the user's first project. Used by the cold-outreach
 * flow — a prospect lands on /audit/<token> from a cold mail, signs
 * up, and we want THAT exact audit (not whatever's tied to their
 * browser cookie, which won't exist) to become their project.
 *
 * Idempotent: if the audit is already claimed by another user, returns
 * null and doesn't touch the DB. The caller falls back to a normal
 * post-signup redirect.
 */
export async function claimAuditByToken(
  userId: string,
  auditToken: string
): Promise<{ projectId: string | null }> {
  const audit = await db.query.audits.findFirst({
    where: and(eq(audits.anonToken, auditToken), isNull(audits.projectId)),
    columns: { id: true, domain: true, platform: true, url: true }
  });
  if (!audit) return { projectId: null };

  const projectId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      userId,
      name: audit.domain,
      source: audit.platform,
      url: audit.url,
      domain: audit.domain
    });
    await tx.update(audits).set({ projectId, anonToken: null }).where(eq(audits.id, audit.id));
  });
  return { projectId };
}

/**
 * On signup: convert the most recent anonymous audit attached to this token
 * into the user's first project (free-tier = 1 project max). Older anon
 * audits stay public but lose their token so they can't be re-claimed.
 */
export async function claimAnonAudits(
  userId: string,
  anonToken: string
): Promise<{ projectId: string | null }> {
  // Two-step: get the candidate ids ordered by recency (tiny
  // projection — sort buffer stays small), then fetch only the
  // fields we need from the most-recent one. Avoids filesort on the
  // multi-MB `summary` JSON.
  const candidateIds = await db
    .select({ id: audits.id })
    .from(audits)
    .where(and(eq(audits.anonToken, anonToken), isNull(audits.projectId)))
    .orderBy(desc(audits.createdAt))
    .limit(10);
  if (candidateIds.length === 0) return { projectId: null };

  const candidates = await db.query.audits.findMany({
    where: inArray(
      audits.id,
      candidateIds.map((r) => r.id)
    ),
    columns: { id: true, domain: true, platform: true, url: true, createdAt: true }
  });
  // findMany order isn't guaranteed; pick the most recent ourselves
  // from the small in-memory set.
  candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const mostRecent = candidates[0];
  const projectId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      userId,
      name: mostRecent.domain,
      source: mostRecent.platform,
      url: mostRecent.url,
      domain: mostRecent.domain
    });
    await tx.update(audits).set({ projectId, anonToken: null }).where(eq(audits.id, mostRecent.id));
    for (const older of candidates.slice(1)) {
      await tx.update(audits).set({ anonToken: null }).where(eq(audits.id, older.id));
    }
  });

  return { projectId };
}
