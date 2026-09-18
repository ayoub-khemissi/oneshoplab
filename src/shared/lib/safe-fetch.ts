import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetch an image from a URL that came out of a merchant's file.
 *
 * `uploadFromUrl` in shared/storage trusts its input (kie.ai result URLs we
 * generated ourselves). A CSV import is the opposite: every link is chosen by
 * the customer, so this fetcher refuses everything that would let a URL turn
 * the worker into a proxy onto our own network — plain http, private or
 * loopback addresses (literal or via DNS), redirects (which could hop to any
 * of those after the checks), non-image bodies, oversized bodies, slow hosts.
 * Everything stays in memory; nothing is written to disk.
 */

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'scheme'
  | 'private_host'
  | 'redirect'
  | 'not_image'
  | 'too_large'
  | 'timeout'
  | 'http'
  | 'network';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

export interface FetchRemoteImageOptions {
  /** Hard ceiling on the body, checked on Content-Length and while streaming. */
  maxBytes?: number;
  /** Whole operation (connect + headers + body), enforced with an AbortController. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests: every address the hostname resolves to. */
  lookup?: (host: string) => Promise<string[]>;
}

export interface RemoteImage {
  buffer: Buffer;
  contentType: string;
}

export const IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

const ALLOWED_TYPES: ReadonlySet<string> = new Set(IMAGE_CONTENT_TYPES);
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

/** IPv4 ranges that must never be fetched from (RFC 6890 special-purpose + multicast). */
const BLOCKED_V4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (CGNAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata lives here)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved + limited broadcast
];

function parseV4(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function v4InBlock(addr: number, [base, bits]: [string, number]): boolean {
  const b = parseV4(base) as number;
  const shift = 32 - bits;
  return Math.floor(addr / 2 ** shift) === Math.floor(b / 2 ** shift);
}

function isBlockedV4(addr: number): boolean {
  return BLOCKED_V4.some((block) => v4InBlock(addr, block));
}

/** Expand an IPv6 literal into its eight 16-bit groups; null when malformed. */
function parseV6(host: string): number[] | null {
  const raw = host.split('%')[0]; // drop a zone id
  if (isIP(raw) !== 6) return null;
  let text = raw;
  // Embedded dotted IPv4 tail (::ffff:127.0.0.1) → two hex groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseV4(tail);
    if (v4 === null) return null;
    const hi = Math.floor(v4 / 65536).toString(16);
    const lo = (v4 % 65536).toString(16);
    text = `${text.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...rest].map((g) =>
    parseInt(g, 16)
  );
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) {
    return null;
  }
  return groups;
}

function isBlockedV6(g: number[]): boolean {
  const embeddedV4 = (hiIndex: number) => g[hiIndex] * 65536 + g[hiIndex + 1];
  const leading = g.slice(0, 6).every((x) => x === 0);
  // :: (unspecified) and ::1 (loopback)
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true;
  // ::ffff:a.b.c.d — IPv4-mapped: judge the embedded IPv4.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedV4(embeddedV4(6));
  // ::a.b.c.d — deprecated IPv4-compatible.
  if (leading) return true;
  // 64:ff9b::/96 — NAT64 well-known prefix.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedV4(embeddedV4(6));
  }
  // 2002::/16 — 6to4: the IPv4 sits in groups 1–2.
  if (g[0] === 0x2002) return isBlockedV4(embeddedV4(1));
  // 100::/64 — discard-only.
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  // 2001:db8::/32 — documentation.
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  // 2001::/23 — IETF protocol assignments (incl. ORCHID, Teredo).
  if (g[0] === 0x2001 && g[1] < 0x0200) return true;
  // fc00::/7 — unique local.
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local, fec0::/10 deprecated site-local.
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;
  // ff00::/8 — multicast.
  if ((g[0] & 0xff00) === 0xff00) return true;
  return false;
}

/**
 * True when `address` (an IPv4 or IPv6 literal) must never be contacted:
 * private, loopback, link-local, multicast, reserved, or an IPv6 form that
 * embeds such an IPv4. Unparseable input counts as blocked.
 */
export function isPrivateAddress(address: string): boolean {
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const v4 = parseV4(bare);
  if (v4 !== null) return isBlockedV4(v4);
  const v6 = parseV6(bare);
  if (v6 !== null) return isBlockedV6(v6);
  return true;
}

async function defaultLookup(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

function normaliseContentType(raw: string | null): string {
  return (raw ?? '').split(';')[0].trim().toLowerCase();
}

async function readBody(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new SafeFetchError('too_large', `Body exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  }
  return Buffer.concat(chunks, total);
}

export async function fetchRemoteImage(
  url: string,
  opts: FetchRemoteImageOptions = {}
): Promise<RemoteImage> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lookup = opts.lookup ?? defaultLookup;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeFetchError('invalid_url', 'Not a valid absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new SafeFetchError('scheme', `Only https is allowed (got ${parsed.protocol})`);
  }
  if (parsed.username || parsed.password) {
    throw new SafeFetchError('invalid_url', 'Credentials in URL are not allowed');
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) throw new SafeFetchError('invalid_url', 'Missing hostname');
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(literal)) {
    if (isPrivateAddress(literal)) {
      throw new SafeFetchError('private_host', `Address ${literal} is not public`);
    }
  } else {
    if (host === 'localhost' || host.endsWith('.localhost')) {
      throw new SafeFetchError('private_host', 'localhost is not allowed');
    }
    let addresses: string[];
    try {
      addresses = await lookup(host);
    } catch (e) {
      throw new SafeFetchError('network', `DNS lookup failed: ${(e as Error).message}`);
    }
    if (addresses.length === 0) {
      throw new SafeFetchError('network', `Hostname ${host} does not resolve`);
    }
    const bad = addresses.find((a) => isPrivateAddress(a));
    if (bad) {
      throw new SafeFetchError('private_host', `Hostname ${host} resolves to ${bad}`);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(parsed.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: IMAGE_CONTENT_TYPES.join(',') }
      });
    } catch (e) {
      if (controller.signal.aborted) {
        throw new SafeFetchError('timeout', `No response within ${timeoutMs} ms`);
      }
      throw new SafeFetchError('network', (e as Error).message || 'Network error');
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError('redirect', `Redirects are not followed (HTTP ${res.status})`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError('http', `HTTP ${res.status}`);
    }

    const contentType = normaliseContentType(res.headers.get('content-type'));
    if (!ALLOWED_TYPES.has(contentType)) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError(
        'not_image',
        `Content-Type ${contentType || '(none)'} is not an image`
      );
    }

    const declared = res.headers.get('content-length');
    if (declared !== null) {
      const len = Number(declared);
      if (Number.isFinite(len) && len > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new SafeFetchError('too_large', `Content-Length ${len} exceeds ${maxBytes} bytes`);
      }
    }

    let buffer: Buffer;
    try {
      buffer = await readBody(res, maxBytes);
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      if (controller.signal.aborted) {
        throw new SafeFetchError('timeout', `Body not received within ${timeoutMs} ms`);
      }
      throw new SafeFetchError('network', (e as Error).message || 'Network error');
    }
    if (buffer.length === 0) throw new SafeFetchError('not_image', 'Empty body');

    return { buffer, contentType };
  } finally {
    clearTimeout(timer);
  }
}
