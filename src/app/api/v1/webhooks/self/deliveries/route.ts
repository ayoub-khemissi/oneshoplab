import { DEFAULT_BUCKET, withSiteKey } from '@/entities/api-key';
import {
  deliveriesQuerySchema,
  getSelfWebhook,
  listDeliveries,
  type WebhookDeliveryView
} from '@/entities/outbound-webhook';
import { errorResponse, jsonResponse } from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toWire(d: WebhookDeliveryView) {
  return {
    id: d.id,
    eventId: d.eventId,
    event: d.event,
    attempt: d.attempt,
    status: d.status,
    responseStatus: d.responseStatus,
    nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString()
  };
}

export const GET = withSiteKey(
  async (req, ctx) => {
    const parsed = deliveriesQuerySchema.safeParse({
      limit: new URL(req.url).searchParams.get('limit') ?? undefined
    });
    if (!parsed.success) {
      return errorResponse('validation', 'Invalid query', 422, {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      });
    }
    const hook = await getSelfWebhook(ctx.project.id);
    if (!hook) return errorResponse('not_found', 'No webhook registered', 404);
    const rows = await listDeliveries(ctx.project.id, parsed.data.limit, hook.id);
    return jsonResponse({
      webhook: {
        id: hook.id,
        url: hook.url,
        enabled: hook.enabled,
        disabledAt: hook.disabledAt?.toISOString() ?? null
      },
      deliveries: rows.map(toWire)
    });
  },
  { permission: 'webhooks:manage', bucket: DEFAULT_BUCKET }
);
