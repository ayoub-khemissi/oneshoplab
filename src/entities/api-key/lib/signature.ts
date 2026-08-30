/**
 * `X-OSL-Signature: t=<unix seconds>,v1=<hex>` where
 * `v1 = HMAC-SHA256(key, "${t}.${METHOD}.${path}.${sha256(rawBody)}")`.
 * `path` is the URL pathname (no query string, no host). Window ±300 s.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-osl-signature';
export const SIGNATURE_WINDOW_SEC = 300;

export type SignatureFailure = 'missing' | 'signature_invalid' | 'clock_skew';

export interface SignedRequestParts {
  method: string;
  path: string;
  body: string | Buffer;
}

export type VerifySignatureResult =
  { ok: true; t: number } | { ok: false; reason: SignatureFailure; serverTime: number };

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function signingPayload(t: number, parts: SignedRequestParts): string {
  return `${t}.${parts.method.toUpperCase()}.${parts.path}.${sha256Hex(parts.body)}`;
}

export function computeSignature(key: string, t: number, parts: SignedRequestParts): string {
  return createHmac('sha256', key).update(signingPayload(t, parts)).digest('hex');
}

/** What a plugin sends: builds the header value for `parts` at time `t`. */
export function buildSignatureHeader(
  key: string,
  parts: SignedRequestParts,
  t: number = Math.floor(Date.now() / 1000)
): string {
  return `t=${t},v1=${computeSignature(key, t, parts)}`;
}

export function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) v1 = v.toLowerCase();
  }
  return t !== null && v1 !== null ? { t, v1 } : null;
}

/**
 * HMAC is checked BEFORE the window so a correctly signed but skewed
 * request gets `clock_skew` (with the server time, so the plugin can fix
 * its clock) while a wrong secret is always `signature_invalid`.
 */
export function verifySignature(
  key: string,
  header: string | null | undefined,
  parts: SignedRequestParts,
  nowSec: number = Math.floor(Date.now() / 1000)
): VerifySignatureResult {
  if (!header) return { ok: false, reason: 'missing', serverTime: nowSec };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: 'signature_invalid', serverTime: nowSec };
  const expected = computeSignature(key, parsed.t, parts);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parsed.v1, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature_invalid', serverTime: nowSec };
  }
  if (Math.abs(nowSec - parsed.t) > SIGNATURE_WINDOW_SEC) {
    return { ok: false, reason: 'clock_skew', serverTime: nowSec };
  }
  return { ok: true, t: parsed.t };
}
