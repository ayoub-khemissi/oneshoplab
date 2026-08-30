import { withSiteKey } from '@/entities/api-key';
import { syncBodySchema, syncCatalog } from '@/features/catalog-sync';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  errorResponse,
  getIdempotent,
  jsonResponse,
  parseJsonBody,
  putIdempotent
} from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Spec §3: 30/min per key. */
const SYNC_BUCKET = { capacity: 30, refillPerSec: 0.5 };

export const POST = withSiteKey(
  async (req, ctx) => {
    const idemKey = req.headers.get('idempotency-key')?.trim() ?? '';
    if (!idemKey || idemKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      return errorResponse('validation', 'Idempotency-Key header is required (≤128 chars)', 422, {
        header: 'Idempotency-Key'
      });
    }
    const cached = await getIdempotent(ctx.key.id, idemKey, ctx.bodyHash);
    if (cached.kind === 'hit') return jsonResponse(cached.response, cached.status);
    if (cached.kind === 'mismatch') {
      return errorResponse(
        'idempotency_mismatch',
        'Idempotency-Key was already used with a different body',
        409
      );
    }

    const parsed = await parseJsonBody(ctx.rawBody, syncBodySchema);
    if (!parsed.ok) return parsed.response;

    const result = await syncCatalog({
      project: ctx.project,
      body: parsed.data,
      platformHeader: req.headers.get('x-osl-platform')
    });
    // Only successes are replayed: 409/422/423 answers depend on state the
    // plugin is expected to fix and retry with the same key.
    await putIdempotent(ctx.key.id, idemKey, ctx.bodyHash, 200, result);
    return jsonResponse(result);
  },
  { permission: 'catalog:write', bucket: SYNC_BUCKET }
);
