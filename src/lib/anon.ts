import { and, desc, eq, isNull } from 'drizzle-orm';
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
 * On signup: convert the most recent anonymous audit attached to this token
 * into the user's first project (free-tier = 1 project max). Older anon
 * audits stay public but lose their token so they can't be re-claimed.
 */
export async function claimAnonAudits(
  userId: string,
  anonToken: string
): Promise<{ projectId: string | null }> {
  const candidates = await db.query.audits.findMany({
    where: and(eq(audits.anonToken, anonToken), isNull(audits.projectId)),
    orderBy: [desc(audits.createdAt)],
    limit: 10
  });
  if (candidates.length === 0) return { projectId: null };

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
    await tx
      .update(audits)
      .set({ projectId, anonToken: null })
      .where(eq(audits.id, mostRecent.id));
    for (const older of candidates.slice(1)) {
      await tx.update(audits).set({ anonToken: null }).where(eq(audits.id, older.id));
    }
  });

  return { projectId };
}
