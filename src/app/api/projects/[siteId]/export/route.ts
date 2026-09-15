import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import {
  buildCatalogCsv,
  exportFilename,
  loadExportRow,
  loadExportRows,
  parseExportQuery,
  takeExportToken,
  type RawParams
} from '@/features/export-catalog';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';

export const dynamic = 'force-dynamic';

/**
 * CSV export of a project's catalogue.
 *
 * Auth: the session must own the project. A project that exists but belongs
 * to somebody else answers 404, not 403 — a 403 would confirm the id is real.
 * Rate limited per user (see EXPORT_BUCKET) because building a file is the
 * most expensive read a logged-in user can trigger on demand.
 *
 * `?productId=` exports that single product; without it the merchant's
 * current filters and column selection are applied, capped at MAX_EXPORT_ROWS.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ siteId: string }> }
): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { siteId } = await ctx.params;
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, siteId),
    columns: { id: true, userId: true, domain: true, name: true }
  });
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const limit = takeExportToken(userId);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  const raw: RawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const query = parseExportQuery(raw);
  const productId = req.nextUrl.searchParams.get('productId');

  const rows = productId
    ? [await loadExportRow(project.id, productId)].filter((r) => r != null)
    : await loadExportRows(project.id, query);

  if (productId && rows.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const csv = buildCatalogCsv(rows, query.columns);
  const label = productId
    ? `${project.domain ?? project.name}-${rows[0]?.handle ?? 'product'}`
    : (project.domain ?? project.name ?? 'catalogue');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename(label)}"`,
      // Never let a shared cache hold a merchant's catalogue.
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex'
    }
  });
}
