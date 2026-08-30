/**
 * Shopify's mandatory compliance webhooks (public app review). OSL stores
 * no customer data: `customers/*` are acknowledged and logged;
 * `shop/redact` (48 h after uninstall) also wipes every connection row of
 * that shop. HMAC key = the app's client secret.
 */
import { recordGdprRequest, revokeByShopDomain } from '@/entities/shop-connection';
import { GDPR_TOPICS, type GdprTopic } from '@/shared/db/schema';
import { shopifyAppConfig } from '../lib/oauth';
import { SHOPIFY_HMAC_HEADER, verifyShopifyHmac } from '../lib/webhook-hmac';

/** URL segment → topic (`/api/webhooks/shopify/gdpr/<segment>`). */
export const GDPR_ROUTE_TOPICS: Record<string, GdprTopic> = {
  'customers-data-request': 'customers/data_request',
  'customers-redact': 'customers/redact',
  'shop-redact': 'shop/redact'
};

export interface GdprOutcome {
  status: 200 | 401 | 404;
  body: { ok: boolean; action?: string; error?: string };
}

export async function handleShopifyGdprWebhook(req: {
  segment: string;
  rawBody: string;
  headers: Headers;
}): Promise<GdprOutcome> {
  const topic = GDPR_ROUTE_TOPICS[req.segment];
  if (!topic || !GDPR_TOPICS.includes(topic))
    return { status: 404, body: { ok: false, error: 'unknown_topic' } };
  const cfg = shopifyAppConfig();
  if (!cfg) return { status: 401, body: { ok: false, error: 'not_configured' } };
  if (!verifyShopifyHmac(req.rawBody, req.headers.get(SHOPIFY_HMAC_HEADER), cfg.clientSecret))
    return { status: 401, body: { ok: false, error: 'bad_hmac' } };

  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(req.rawBody);
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const shopDomain =
    (typeof payload.shop_domain === 'string' && payload.shop_domain.toLowerCase()) ||
    req.headers.get('x-shopify-shop-domain')?.toLowerCase() ||
    '';
  await recordGdprRequest(shopDomain, topic, payload);
  if (topic === 'shop/redact' && shopDomain) {
    const n = await revokeByShopDomain(shopDomain, 'shop/redact');
    return { status: 200, body: { ok: true, action: `revoked:${n}` } };
  }
  return { status: 200, body: { ok: true, action: 'logged' } };
}
