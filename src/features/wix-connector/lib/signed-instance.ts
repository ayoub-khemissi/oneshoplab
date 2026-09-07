import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The `signedInstance` Wix appends to our callback after an install — and the
 * `instance` query parameter its dashboards pass to external pages. Same
 * format for both: `<signature>.<data>`, where `data` is base64url JSON and
 * the signature is HMAC-SHA256 of the *data string as sent*, keyed with the
 * app secret, base64url without padding.
 *
 * This is the only proof that an install happened. The plain `instanceId`
 * next to it in the query string is just text anyone can type; it is trusted
 * only once it matches the one inside a payload whose signature checks out.
 */
export interface WixSignedInstance {
  instanceId: string;
  /** The Wix user who installed; equals `siteOwnerId` for the owner. */
  uid: string | null;
  siteOwnerId: string | null;
  permissions: string | null;
  signDate: string | null;
  /** Set when the site was duplicated from another one carrying our app. */
  originInstanceId: string | null;
}

function fromBase64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function verifySignedInstance(
  signed: string | null | undefined,
  appSecret: string
): WixSignedInstance | null {
  if (!signed) return null;
  const dot = signed.indexOf('.');
  if (dot <= 0 || dot === signed.length - 1) return null;
  const signature = signed.slice(0, dot);
  const data = signed.slice(dot + 1);
  const expected = createHmac('sha256', appSecret).update(data).digest();
  const given = fromBase64Url(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(fromBase64Url(data).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (k: string) => (typeof json[k] === 'string' && json[k] ? (json[k] as string) : null);
  const instanceId = str('instanceId');
  if (!instanceId) return null;
  return {
    instanceId,
    uid: str('uid'),
    siteOwnerId: str('siteOwnerId'),
    permissions: str('permissions'),
    signDate: str('signDate'),
    originInstanceId: str('originInstanceId')
  };
}

/** The inverse, for tests and fixtures: what Wix would have sent. */
export function signInstance(payload: Record<string, unknown>, appSecret: string): string {
  const data = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = toBase64Url(createHmac('sha256', appSecret).update(data).digest());
  return `${signature}.${data}`;
}
