import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeShopifyHmac, verifyShopifyHmac } from '@/features/shopify-connector';

const secret = 'shpss_api_secret';
const body = '{"id":8123456789012,"title":"Linen shirt"}';

describe('Shopify webhook HMAC', () => {
  it('matches base64(HMAC-SHA256(secret, rawBody))', () => {
    const expected = createHmac('sha256', secret).update(body).digest('base64');
    expect(computeShopifyHmac(body, secret)).toBe(expected);
    expect(verifyShopifyHmac(body, expected, secret)).toBe(true);
    expect(verifyShopifyHmac(Buffer.from(body), ` ${expected} `, secret)).toBe(true);
  });
  it('rejects a changed body, a wrong secret, a malformed or missing header', () => {
    const sig = computeShopifyHmac(body, secret);
    expect(verifyShopifyHmac(body + ' ', sig, secret)).toBe(false);
    expect(verifyShopifyHmac(body, sig, 'other')).toBe(false);
    expect(verifyShopifyHmac(body, 'nope', secret)).toBe(false);
    expect(verifyShopifyHmac(body, null, secret)).toBe(false);
    expect(verifyShopifyHmac(body, '', secret)).toBe(false);
    expect(verifyShopifyHmac(body, sig, '')).toBe(false);
  });
});
