import { withSiteKey } from '@/entities/api-key';
import { listPendingChanges, type ProductChangeRow } from '@/entities/product-change';
import { changesQuerySchema } from '@/features/catalog-sync';
import { errorResponse, jsonResponse } from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Spec §3: 120/min per key. */
const CHANGES_BUCKET = { capacity: 120, refillPerSec: 2 };

function toWire(c: ProductChangeRow) {
  return {
    id: c.id,
    productSourceId: c.productSourceId,
    field: c.field,
    value: c.value,
    sourceJobId: c.sourceJobId,
    approvedAt: c.approvedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null
  };
}

export const GET = withSiteKey(
  async (req, ctx) => {
    const url = new URL(req.url);
    const parsed = changesQuerySchema.safeParse({
      since: url.searchParams.get('since') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined
    });
    if (!parsed.success) {
      return errorResponse('validation', 'Invalid query', 422, {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      });
    }
    const page = await listPendingChanges(ctx.project.id, parsed.data);
    return jsonResponse({ changes: page.changes.map(toWire), nextCursor: page.nextCursor });
  },
  { permission: 'changes:read', bucket: CHANGES_BUCKET }
);
