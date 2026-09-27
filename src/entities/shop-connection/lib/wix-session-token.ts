import { createHmac, timingSafeEqual } from 'node:crypto';
import { WIX_SESSION_ISSUER } from '@/shared/embedded';

/**
 * The session inside the Wix dashboard. Wix hands the dashboard page a signed
 * `instance` once, in the iframe URL, and nothing to later requests — no
 * App Bridge there. So on that first load we mint our own short-lived token
 * for the instance, and the page sends it as `Authorization: Bearer` like
 * the Shopify ID token (the frame gets no cookie of ours). HS256, keyed with
 * a key derived from the Wix app secret; its issuer tells it apart from a
 * Shopify ID token.
 */
export { WIX_SESSION_ISSUER };
/** Long enough for a working session; the page renews it well before. */
export const WIX_SESSION_TTL_SECONDS = 2 * 60 * 60;

export interface WixSessionToken {
  instanceId: string;
  exp: number;
}

export function wixAppSecret(): string | null {
  return process.env.WIX_APP_SECRET?.trim() || null;
}

function key(appSecret: string): Buffer {
  return createHmac('sha256', appSecret).update('oneshoplab-wix-embedded-session').digest();
}

function b64(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function signWixSessionToken(
  instanceId: string,
  appSecret: string,
  now: number = Math.floor(Date.now() / 1000)
): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    iss: WIX_SESSION_ISSUER,
    sub: instanceId,
    iat: now,
    exp: now + WIX_SESSION_TTL_SECONDS
  });
  const sig = createHmac('sha256', key(appSecret)).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** The token's issuer without verifying it — only to pick the verifier. */
export function isWixSessionToken(token: string): boolean {
  const body = token.split('.')[1];
  if (!body) return false;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      iss?: unknown;
    };
    return claims.iss === WIX_SESSION_ISSUER;
  } catch {
    return false;
  }
}

export function verifyWixSessionToken(
  token: string | null | undefined,
  appSecret: string,
  now: number = Math.floor(Date.now() / 1000)
): WixSessionToken | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = createHmac('sha256', key(appSecret)).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (claims.iss !== WIX_SESSION_ISSUER) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  return { instanceId: claims.sub, exp: claims.exp };
}
