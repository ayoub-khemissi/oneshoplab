/**
 * SSRF guard for merchant-supplied webhook URLs: https only, no literal
 * private/loopback/link-local address, no internal-looking hostname, and
 * every address the hostname resolves to must be public. Run at save time
 * AND right before each send (DNS answers change — rebinding).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { WebhookUrlRejection } from '../model/types';

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

function isPrivateIpv4(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (!o) return true;
  const [a, b] = o;
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && o[2] === 0) || // 192.0.0.0/24 IETF
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved + broadcast
  );
}

/** Expand `::`-compressed IPv6 into 8 hextets (numbers); null when malformed. */
function ipv6Hextets(ip: string): number[] | null {
  let s = ip;
  // Embedded IPv4 tail (::ffff:1.2.3.4) → two hextets.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const o = ipv4Octets(v4[1]);
    if (!o) return null;
    s =
      s.slice(0, -v4[1].length) +
      ((o[0] << 8) | o[1]).toString(16) +
      ':' +
      ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array<string>(fill).fill('0'), ...tail];
  const nums = parts.map((h) => parseInt(h, 16));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? nums
    : null;
}

function isPrivateIpv6(ip: string): boolean {
  const h = ipv6Hextets(ip.replace(/%.*$/, ''));
  if (!h) return true;
  const isZeroPrefix = h.slice(0, 5).every((x) => x === 0);
  if (isZeroPrefix && h[5] === 0xffff) {
    // IPv4-mapped ::ffff:a.b.c.d
    return isPrivateIpv4(`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`);
  }
  if (h.slice(0, 7).every((x) => x === 0) && (h[7] === 0 || h[7] === 1)) return true; // :: and ::1
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  if (h[0] === 0x64 && h[1] === 0xff9b) return true; // 64:ff9b::/96 NAT64 → hides v4
  if (h[0] === 0x2002)
    return isPrivateIpv4(`${h[1] >> 8}.${h[1] & 0xff}.${h[2] >> 8}.${h[2] & 0xff}`); // 6to4
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(h)) return true;
  return BLOCKED_SUFFIXES.some((s) => h.endsWith(s));
}

export type UrlCheck =
  { ok: true; url: URL; hostname: string } | { ok: false; reason: WebhookUrlRejection };

/** Synchronous part: scheme, credentials, literal IPs, hostname blocklist. */
export function checkWebhookUrlSync(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (url.username || url.password) return { ok: false, reason: 'invalid_url' };
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) return { ok: false, reason: 'invalid_url' };
  if (isIP(hostname)) {
    return isPrivateAddress(hostname)
      ? { ok: false, reason: 'private_address' }
      : { ok: true, url, hostname };
  }
  if (isBlockedHostname(hostname)) return { ok: false, reason: 'blocked_host' };
  if (!/^[a-z0-9.-]+$/i.test(hostname) || !hostname.includes('.')) {
    return { ok: false, reason: 'blocked_host' };
  }
  return { ok: true, url, hostname };
}

export type ResolvedUrlCheck =
  | { ok: true; url: URL; hostname: string; addresses: string[] }
  | { ok: false; reason: WebhookUrlRejection };

/** Full check: sync rules + every resolved address must be public. */
export async function checkWebhookUrl(
  raw: string,
  lookup: LookupFn = defaultLookup
): Promise<ResolvedUrlCheck> {
  const sync = checkWebhookUrlSync(raw);
  if (!sync.ok) return sync;
  if (isIP(sync.hostname)) return { ...sync, addresses: [sync.hostname] };
  let records: Array<{ address: string }>;
  try {
    records = await lookup(sync.hostname);
  } catch {
    return { ok: false, reason: 'dns_failed' };
  }
  if (records.length === 0) return { ok: false, reason: 'dns_failed' };
  if (records.some((r) => isPrivateAddress(r.address))) {
    return { ok: false, reason: 'private_address' };
  }
  return { ...sync, addresses: records.map((r) => r.address) };
}
