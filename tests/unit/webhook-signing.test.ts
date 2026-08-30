/** Webhook signature contract + retry schedule (docs/api/OUTBOUND-WEBHOOKS.md). */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BACKOFF_SCHEDULE_MS,
  DISABLE_AFTER_FAILURES,
  MAX_DELIVERY_ATTEMPTS,
  WEBHOOK_SECRET_PREFIX,
  backoffDelayMs,
  buildWebhookHeaders,
  generateWebhookSecret,
  shouldDisable,
  signWebhookBody,
  verifyWebhookSignature
} from '@/entities/outbound-webhook';

const SECRET = 'osl_whsec_unit-test-secret-not-real';
const BODY = '{"id":"01J","event":"ping","data":{}}';

describe('signing', () => {
  it('v1 = hex HMAC-SHA256(secret, "ts.body")', () => {
    const expected = createHmac('sha256', SECRET).update(`1756500000.${BODY}`).digest('hex');
    expect(signWebhookBody(SECRET, 1756500000, BODY)).toBe(`v1=${expected}`);
  });
  it('verifies within the window, constant-time, rejects tampering', () => {
    const ts = 1756500000;
    const sig = signWebhookBody(SECRET, ts, BODY);
    expect(verifyWebhookSignature(SECRET, sig, ts, BODY, ts + 10)).toBe(true);
    expect(verifyWebhookSignature(SECRET, sig, ts, BODY + ' ', ts)).toBe(false);
    expect(verifyWebhookSignature('other', sig, ts, BODY, ts)).toBe(false);
    expect(verifyWebhookSignature(SECRET, sig, ts, BODY, ts + 301)).toBe(false);
    expect(verifyWebhookSignature(SECRET, null, ts, BODY, ts)).toBe(false);
    expect(verifyWebhookSignature(SECRET, 'v2=abcd', ts, BODY, ts)).toBe(false);
  });
  it('headers carry event, ids, timestamp, signature and UA', () => {
    const h = buildWebhookHeaders({
      event: 'change.approved',
      eventId: 'E1',
      deliveryId: 'D1',
      ts: 5,
      signature: 'v1=00'
    });
    expect(h).toMatchObject({
      'X-OSL-Event': 'change.approved',
      'X-OSL-Event-Id': 'E1',
      'X-OSL-Delivery-Id': 'D1',
      'X-OSL-Timestamp': '5',
      'X-OSL-Signature': 'v1=00',
      'User-Agent': 'OneShopLab-Webhooks/1',
      'Content-Type': 'application/json'
    });
  });
  it('secrets are prefixed, 256-bit, unique', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(a.length).toBe(WEBHOOK_SECRET_PREFIX.length + 43);
    expect(a).not.toBe(b);
  });
});

describe('backoff', () => {
  it('1m, 5m, 30m, 2h, 12h then dead', () => {
    expect(BACKOFF_SCHEDULE_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    expect(MAX_DELIVERY_ATTEMPTS).toBe(5);
    expect(backoffDelayMs(1)).toBe(60_000);
    expect(backoffDelayMs(2)).toBe(300_000);
    expect(backoffDelayMs(3)).toBe(1_800_000);
    expect(backoffDelayMs(4)).toBe(7_200_000);
    expect(backoffDelayMs(5)).toBeNull();
    expect(backoffDelayMs(0)).toBeNull();
  });
  it('auto-disable on 50 consecutive failures or 7 days of failures', () => {
    const now = new Date('2026-08-30T00:00:00Z');
    expect(shouldDisable(DISABLE_AFTER_FAILURES - 1, now, now)).toBe(false);
    expect(shouldDisable(DISABLE_AFTER_FAILURES, now, now)).toBe(true);
    expect(shouldDisable(1, new Date('2026-08-23T00:00:01Z'), now)).toBe(false);
    expect(shouldDisable(1, new Date('2026-08-23T00:00:00Z'), now)).toBe(true);
    expect(shouldDisable(1, null, now)).toBe(false);
  });
});
