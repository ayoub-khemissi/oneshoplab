import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeShopDomain } from '@/entities/shop-connection/client';

/**
 * Shopify ID token (a.k.a. session token): the HS256 JWT App Bridge hands the
 * embedded app, signed with the app's client secret. It is the only identity
 * an embedded request carries — the admin iframe gets no first-party cookie.
 * Checks follow Shopify's spec: signature, exp/nbf (with a little clock
 * leeway), aud = client id, iss and dest on the same shop.
 */
export interface ShopifyIdToken {
  shop: string;
  /** Staff member id, as a string. */
  userId: string | null;
  sessionId: string | null;
  exp: number;
}

const LEEWAY_SECONDS = 10;

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function verifyShopifyIdToken(
  token: string | null | undefined,
  cfg: { clientId: string; clientSecret: string },
  now: number = Math.floor(Date.now() / 1000)
): ShopifyIdToken | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const header = b64urlJson(h);
  if (!header || header.alg !== 'HS256') return null;
  const expected = createHmac('sha256', cfg.clientSecret).update(`${h}.${p}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const claims = b64urlJson(p);
  if (!claims) return null;
  const exp = Number(claims.exp);
  const nbf = Number(claims.nbf ?? claims.iat ?? 0);
  if (!Number.isFinite(exp) || exp + LEEWAY_SECONDS < now) return null;
  if (Number.isFinite(nbf) && nbf - LEEWAY_SECONDS > now) return null;
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(cfg.clientId) : aud === cfg.clientId;
  if (!audOk) return null;
  const destHost = hostOf(claims.dest);
  const issHost = hostOf(claims.iss);
  if (!destHost || destHost !== issHost) return null;
  const shop = normalizeShopDomain(destHost);
  if (!shop) return null;
  return {
    shop,
    userId: claims.sub == null ? null : String(claims.sub),
    sessionId: typeof claims.sid === 'string' ? claims.sid : null,
    exp
  };
}

/** Test helper and the reference for the claim layout above. */
export function signShopifyIdTokenForTests(
  claims: Record<string, unknown>,
  clientSecret: string
): string {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = createHmac('sha256', clientSecret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

/** The Bearer token App Bridge's fetch interceptor adds to same-origin calls. */
export function bearerFrom(headers: Headers): string | null {
  const v = headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(v.trim());
  return m ? m[1].trim() : null;
}
