import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * One-click sign-in from the Shopify embedded app into the full web app: the
 * embedded page (authenticated by Shopify's ID token) asks for this short,
 * single-use ticket and opens it in a new tab, where it becomes a normal
 * session cookie. Two minutes, signed with AUTH_SECRET, spent on first use.
 */
const TTL_MS = 2 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

function mac(payload: string): string {
  return createHmac('sha256', secret()).update(`sso.${payload}`).digest('base64url');
}

export function createSsoToken(userId: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: now + TTL_MS, jti: randomBytes(12).toString('base64url') })
  ).toString('base64url');
  return `${payload}.${mac(payload)}`;
}

export function verifySsoToken(
  token: string | null | undefined,
  now: number = Date.now()
): { userId: string; jti: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid?: string;
      exp?: number;
      jti?: string;
    };
    if (typeof p.uid !== 'string' || typeof p.jti !== 'string' || typeof p.exp !== 'number')
      return null;
    if (p.exp < now) return null;
    return { userId: p.uid, jti: p.jti };
  } catch {
    return null;
  }
}
