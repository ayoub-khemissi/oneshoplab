import { NextResponse, type NextRequest } from 'next/server';
import {
  commitImport,
  guardImportRoute,
  importRequestSchema,
  IMPORT_BODY_MAX_BYTES
} from '@/features/import-catalog';
import { enqueueImageMirrors } from '@/entities/product';
import { parseJsonBody, toErrorResponse } from '@/shared/api';

export const dynamic = 'force-dynamic';

/** Write a CSV import. The plan is recomputed from the file; the preview is not trusted. */
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
    // External image links are copied to our storage by the worker; the
    // product shows its link meanwhile (see entities/product image-mirror).
    const result = await commitImport(guard.projectId, parsed.data, {
      enqueue: enqueueImageMirrors
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : result.reason === 'locked' ? 423 : 422,
      headers: { 'Cache-Control': 'no-store, private' }
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
