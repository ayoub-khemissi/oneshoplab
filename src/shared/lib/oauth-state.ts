/**
 * Signed, short-lived OAuth `state` for the store-connector install flows:
 * the browser keeps `<payload b64url>.<hmac>` in an httpOnly cookie, the
 * provider echoes only the nonce. Binding the nonce to the cookie (and the
 * cookie to a signature) defeats a forged callback and CSRF on the callback.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OauthStatePayload {
  nonce: string;
  issuedAt: number;
  projectId: string;
  userId: string;
  locale: string;
  /** Provider-specific binding (Shopify: the shop domain). */
  subject?: string;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createOauthState(
  input: Omit<OauthStatePayload, 'nonce' | 'issuedAt'>,
  secret: string,
  now: Date = new Date()
): { state: string; cookieValue: string } {
  const payload: OauthStatePayload = {
    ...input,
    nonce: randomBytes(16).toString('base64url'),
    issuedAt: now.getTime()
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { state: payload.nonce, cookieValue: `${encoded}.${sign(encoded, secret)}` };
}

/** Null when the cookie is missing, tampered, expired or does not match `state`. */
export function verifyOauthState(
  cookieValue: string | null | undefined,
  state: string | null | undefined,
  secret: string,
  now: Date = new Date()
): OauthStatePayload | null {
  if (!cookieValue || !state) return null;
  const [encoded, mac] = cookieValue.split('.');
  if (!encoded || !mac) return null;
  const expected = Buffer.from(sign(encoded, secret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: OauthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OauthStatePayload;
  } catch {
    return null;
  }
  if (typeof payload.nonce !== 'string' || typeof payload.issuedAt !== 'number') return null;
  if (payload.nonce !== state) return null;
  if (now.getTime() - payload.issuedAt > OAUTH_STATE_TTL_MS || payload.issuedAt > now.getTime())
    return null;
  return payload;
}
