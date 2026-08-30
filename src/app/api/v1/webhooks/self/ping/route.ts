import { DEFAULT_BUCKET, withSiteKey } from '@/entities/api-key';
import { enqueuePing, getSelfWebhook } from '@/entities/outbound-webhook';
import { errorResponse, jsonResponse } from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Enqueue a `ping`; the worker sends it on its next tick. Poll /deliveries for the result. */
export const POST = withSiteKey(
  async (_req, ctx) => {
    const hook = await getSelfWebhook(ctx.project.id);
    if (!hook) return errorResponse('not_found', 'No webhook registered', 404);
    return jsonResponse({ deliveryId: await enqueuePing(hook.id) }, 202);
  },
  { permission: 'webhooks:manage', bucket: DEFAULT_BUCKET }
);
