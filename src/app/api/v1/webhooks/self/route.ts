import { DEFAULT_BUCKET, withSiteKey } from '@/entities/api-key';
import {
  selfWebhookBodySchema,
  deleteSelfWebhook,
  upsertSelfWebhook
} from '@/entities/outbound-webhook';
import { errorResponse, jsonResponse, parseJsonBody } from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Register (or re-register: same url → rotated secret) the plugin's endpoint. */
export const PUT = withSiteKey(
  async (_req, ctx) => {
    const parsed = await parseJsonBody(ctx.rawBody, selfWebhookBodySchema);
    if (!parsed.ok) return parsed.response;
    const res = await upsertSelfWebhook(ctx.project.id, {
      url: parsed.data.url,
      events: parsed.data.events,
      createdBy: ctx.key.userId
    });
    if (!res.ok) {
      if (res.reason === 'sealing_unavailable') {
        return errorResponse('internal', 'Webhook secrets cannot be stored right now', 500);
      }
      return errorResponse('validation', 'Webhook url rejected', 422, { reason: res.reason });
    }
    return jsonResponse({ id: res.id, secret: res.secret }, res.rotated ? 200 : 201);
  },
  { permission: 'webhooks:manage', bucket: DEFAULT_BUCKET }
);

export const DELETE = withSiteKey(
  async (_req, ctx) => {
    const deleted = await deleteSelfWebhook(ctx.project.id);
    return jsonResponse({ deleted });
  },
  { permission: 'webhooks:manage', bucket: DEFAULT_BUCKET }
);
