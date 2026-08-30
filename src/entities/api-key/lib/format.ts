import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_PREFIX = 'osl_live_';
/** Chars stored for lookup (`osl_live_` + 3). */
export const API_KEY_PREFIX_LENGTH = 12;
const RANDOM_BYTES = 32; // 256 bits → 43 base64url chars
export const API_KEY_RE = /^osl_live_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(RANDOM_BYTES).toString('base64url');
}

export function looksLikeApiKey(value: string): boolean {
  return API_KEY_RE.test(value);
}

export function prefixOf(key: string): string {
  return key.slice(0, API_KEY_PREFIX_LENGTH);
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Constant-time compare of two hex digests (false on length mismatch). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length * 2 !== a.length) return false;
  return timingSafeEqual(ba, bb);
}
