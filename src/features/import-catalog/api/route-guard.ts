import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { auth } from '@/entities/user';
import { take } from '@/shared/api';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';

/**
 * Import budget per user: 5 files, one back every ten minutes. An import is
 * the heaviest write a merchant can trigger by hand; nobody needs more than
 * that, and a script would otherwise use this as a bulk-write endpoint.
 */
export const IMPORT_BUCKET = { capacity: 5, refillPerSec: 1 / 600 };

export type GuardResult =
  { ok: true; userId: string; projectId: string } | { ok: false; response: Response };

/**
 * Everything both import routes require before reading a byte of the body:
 * a session, a project the caller owns, and a project that is a "my own
 * store" one. A Shopify, Wix or WooCommerce project answers 404 — its
 * catalogue belongs to the store upstream, importing into it would fight the
 * sync, and 404 rather than 403 keeps a foreign id unconfirmed.
 */
export async function guardImportRoute(siteId: string): Promise<GuardResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    };
  }
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, userId)),
    columns: { id: true, source: true }
  });
  if (!project || project.source !== 'manual') {
    return { ok: false, response: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  const limit = take(`import:${userId}`, IMPORT_BUCKET);
  if (!limit.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'rate_limited', retryAfterSec: limit.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
      )
    };
  }
  return { ok: true, userId, projectId: project.id };
}
