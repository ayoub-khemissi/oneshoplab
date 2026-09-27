import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A short-lived, signed invitation to attach one store install (a Shopify
 * shop, a Wix site) to whoever logs in on the website. The store admin opens
 * it in a new tab, where our first-party cookie session exists; logging in
 * is the proof of ownership. Bound to its store platform: a Wix link cannot
 * attach a Shopify shop.
 */
export type StoreLinkHost = 'shopify' | 'wix';

const LINK_TTL_MS = 15 * 60 * 1000;

function linkSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

function mac(host: StoreLinkHost, payload: string): string {
  // Shopify's links predate the other hosts: keep their prefix so a link
  // opened across a deploy still works.
  const prefix = host === 'shopify' ? 'shop-link' : `${host}-link`;
  return createHmac('sha256', linkSecret()).update(`${prefix}.${payload}`).digest('base64url');
}

export function createStoreLinkToken(
  host: StoreLinkHost,
  subject: string,
  now: number = Date.now()
): string {
  const payload = Buffer.from(
    JSON.stringify({
      shop: subject,
      exp: now + LINK_TTL_MS,
      n: randomBytes(8).toString('base64url')
    })
  ).toString('base64url');
  return `${payload}.${mac(host, payload)}`;
}

/** The store the link is for (shop domain, Wix instance id), or null. */
export function verifyStoreLinkToken(
  host: StoreLinkHost,
  token: string | null | undefined,
  now: number = Date.now()
): string | null {
  if (!token) return null;
  const [payload, given] = token.split('.');
  if (!payload || !given) return null;
  const expected = Buffer.from(mac(host, payload));
  const got = Buffer.from(given);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      shop?: string;
      exp?: number;
    };
    if (typeof p.shop !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
    return p.shop;
  } catch {
    return null;
  }
}

/** `j•••••@shop.com`: enough for the owner to recognise it, not to harvest it. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return null;
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}
