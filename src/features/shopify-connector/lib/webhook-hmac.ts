import { createHmac, timingSafeEqual } from 'node:crypto';

export const SHOPIFY_HMAC_HEADER = 'x-shopify-hmac-sha256';

/** Shopify signs the raw body with the app's API secret key, base64 HMAC-SHA256. */
export function computeShopifyHmac(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

export function verifyShopifyHmac(
  rawBody: string | Buffer,
  header: string | null | undefined,
  secret: string
): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(computeShopifyHmac(rawBody, secret), 'base64');
  const given = Buffer.from(header.trim(), 'base64');
  if (given.length !== expected.length || given.length === 0) return false;
  return timingSafeEqual(given, expected);
}
