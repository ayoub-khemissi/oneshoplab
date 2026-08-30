/**
 * Receiver contract (docs/api/OUTBOUND-WEBHOOKS.md → Delivery):
 * `X-OSL-Signature: v1=<hex HMAC-SHA256(secret, "${ts}.${rawBody}")>`
 * with `ts` = `X-OSL-Timestamp` (unix seconds). Receivers check ±5 min.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'X-OSL-Signature';
export const WEBHOOK_USER_AGENT = 'OneShopLab-Webhooks/1';
export const WEBHOOK_SECRET_PREFIX = 'osl_whsec_';
export const WEBHOOK_SIGNATURE_WINDOW_SEC = 300;

/** 256 bits, base64url — same entropy as a site key, distinct prefix for scanners. */
export function generateWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + randomBytes(32).toString('base64url');
}

export function signWebhookBody(secret: string, ts: number, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
}

export interface WebhookHeaderInput {
  event: string;
  eventId: string;
  deliveryId: string;
  ts: number;
  signature: string;
}

export function buildWebhookHeaders(h: WebhookHeaderInput): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': WEBHOOK_USER_AGENT,
    'X-OSL-Event': h.event,
    'X-OSL-Event-Id': h.eventId,
    'X-OSL-Delivery-Id': h.deliveryId,
    'X-OSL-Timestamp': String(h.ts),
    [WEBHOOK_SIGNATURE_HEADER]: h.signature
  };
}

/** Reference verifier (what a receiver does) — used by the tests. */
export function verifyWebhookSignature(
  secret: string,
  header: string | null,
  ts: number,
  rawBody: string,
  now: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!header || !header.startsWith('v1=')) return false;
  if (Math.abs(now - ts) > WEBHOOK_SIGNATURE_WINDOW_SEC) return false;
  const expected = Buffer.from(signWebhookBody(secret, ts, rawBody).slice(3), 'hex');
  const given = Buffer.from(header.slice(3), 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
