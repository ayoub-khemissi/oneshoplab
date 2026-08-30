import { withSiteKey } from '@/entities/api-key';
import { ackChange } from '@/entities/product-change';
import { ackBodySchema } from '@/features/catalog-sync';
import { errorResponse, jsonResponse, parseJsonBody } from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Spec §3: 240/min per key. */
const ACK_BUCKET = { capacity: 240, refillPerSec: 4 };

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return withSiteKey(
    async (_req, ctx) => {
      const parsed = await parseJsonBody(ctx.rawBody, ackBodySchema);
      if (!parsed.ok) return parsed.response;
      const res = await ackChange(ctx.project.id, id, parsed.data);
      if (res.kind === 'not_found') return errorResponse('not_found', 'Unknown change', 404);
      if (res.kind === 'already_acked') {
        return errorResponse('already_acked', 'Change was acknowledged with another status', 409, {
          status: res.change.status
        });
      }
      return jsonResponse({ status: res.change.status });
    },
    { permission: 'changes:ack', bucket: ACK_BUCKET }
  )(req);
}
