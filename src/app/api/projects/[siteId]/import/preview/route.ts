import { NextResponse, type NextRequest } from 'next/server';
import {
  guardImportRoute,
  importRequestSchema,
  IMPORT_BODY_MAX_BYTES,
  previewImport
} from '@/features/import-catalog';
import { parseJsonBody, toErrorResponse } from '@/shared/api';

export const dynamic = 'force-dynamic';

/** Dry run of a CSV import: what would be created, updated, skipped, rejected. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ siteId: string }> }
): Promise<Response> {
  const { siteId } = await ctx.params;
  const guard = await guardImportRoute(siteId);
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseJsonBody(req, importRequestSchema, {
      maxBytes: IMPORT_BODY_MAX_BYTES
    });
    if (!parsed.ok) return parsed.response;
    const preview = await previewImport(guard.projectId, parsed.data);
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
