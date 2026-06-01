import { and, eq, gt, inArray } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { jobs, products, projects } from '@/lib/db/schema';

/**
 * Lightweight poll endpoint for the F5-resume code path in
 * RetryableGenerateProvider. Returns which chat fields are still
 * 'running' server-side for a given product so the client can refresh
 * once the server flips them off.
 *
 * Auth is mandatory and we cross-check the product → project →
 * user.id chain to keep one tenant from observing another's chat
 * pipeline. Response stays minimal (just the field names) — no
 * payloads, no error messages.
 *
 * Query: ?productId=<uuid>
 * Response: { running: Array<'title'|'description'|'tags'> }
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // Tenant guard: confirm this product belongs to the caller's project.
  const owned = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(projects, eq(projects.id, products.projectId))
    .where(and(eq(products.id, productId), eq(projects.userId, session.user.id)))
    .limit(1);
  if (owned.length === 0) {
    return NextResponse.json({ running: [] satisfies string[] });
  }

  // Match the 5-min orphan cutoff used by the product page's
  // initial-state query — a row older than that with status='running'
  // means the server died mid-chat (kie chat is capped at 90s and our
  // catch flips to 'failed' on any throw), and we don't want the poll
  // loop to keep spinning forever.
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await db
    .select({ kind: jobs.kind })
    .from(jobs)
    .where(
      and(
        eq(jobs.productId, productId),
        eq(jobs.status, 'running'),
        gt(jobs.startedAt, cutoff),
        inArray(jobs.kind, ['kie_title', 'kie_description', 'kie_tags'])
      )
    );

  const running: Array<'title' | 'description' | 'tags'> = [];
  for (const r of rows) {
    if (r.kind === 'kie_title') running.push('title');
    else if (r.kind === 'kie_description') running.push('description');
    else if (r.kind === 'kie_tags') running.push('tags');
  }
  return NextResponse.json({ running });
}
