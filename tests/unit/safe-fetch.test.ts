/**
 * fetchRemoteImage: every guard-rail fires with its own code, and a clean
 * https image comes back as a buffer. No network: fetch and DNS are injected.
 */
import { describe, expect, it, vi } from 'vitest';
import { SafeFetchError, fetchRemoteImage, isPrivateAddress } from '@/shared/lib/safe-fetch';

const PUBLIC_IP = '93.184.216.34';
const publicLookup = async () => [PUBLIC_IP];
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function imageResponse(
  body: BodyInit | null,
  init: { status?: number; type?: string | null; length?: string } = {}
): Response {
  const headers = new Headers();
  if (init.type !== null) headers.set('content-type', init.type ?? 'image/png');
  if (init.length !== undefined) headers.set('content-length', init.length);
  return new Response(body, { status: init.status ?? 200, headers });
}

const fetchReturning = (res: Response): typeof fetch => vi.fn(async () => res);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof SafeFetchError) return e.code;
    throw e;
  }
  throw new Error('expected fetchRemoteImage to throw');
}

describe('URL and address guards', () => {
  it('rejects a malformed URL', async () => {
    expect(await codeOf(fetchRemoteImage('not a url'))).toBe('invalid_url');
  });

  it('refuses plain http', async () => {
    const fetchImpl = vi.fn();
    expect(
      await codeOf(
        fetchRemoteImage('http://cdn.example/a.png', { fetchImpl, lookup: publicLookup })
      )
    ).toBe('scheme');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'https://127.0.0.1/a.png',
    'https://10.1.2.3/a.png',
    'https://172.16.0.9/a.png',
    'https://192.168.1.1/a.png',
    'https://169.254.169.254/latest/meta-data',
    'https://0.0.0.0/a.png',
    'https://224.0.0.1/a.png',
    'https://2130706433/a.png' // decimal 127.0.0.1, normalised by the URL parser
  ])('refuses the private/reserved IPv4 literal %s without DNS or fetch', async (url) => {
    const fetchImpl = vi.fn();
    const lookup = vi.fn();
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup }))).toBe('private_host');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    'https://[::1]/a.png',
    'https://[::]/a.png',
    'https://[fe80::1]/a.png',
    'https://[fc00::1]/a.png',
    'https://[fd12:3456::1]/a.png',
    'https://[ff02::1]/a.png',
    'https://[::ffff:127.0.0.1]/a.png',
    'https://[::ffff:c0a8:101]/a.png', // ::ffff:192.168.1.1 in hex
    'https://[64:ff9b::7f00:1]/a.png', // NAT64 wrapping 127.0.0.1
    'https://[2002:7f00:1::]/a.png' // 6to4 wrapping 127.0.0.1
  ])('refuses the private/reserved IPv6 literal %s', async (url) => {
    const fetchImpl = vi.fn();
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl }))).toBe('private_host');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets a public IP literal through to fetch', async () => {
    const fetchImpl = fetchReturning(imageResponse(PNG));
    const out = await fetchRemoteImage(`https://${PUBLIC_IP}/a.png`, { fetchImpl });
    expect(out.contentType).toBe('image/png');
  });

  it('refuses a hostname when ANY resolved address is private', async () => {
    const fetchImpl = vi.fn();
    const lookup = vi.fn(async () => [PUBLIC_IP, '10.0.0.5']);
    expect(await codeOf(fetchRemoteImage('https://cdn.example/a.png', { fetchImpl, lookup }))).toBe(
      'private_host'
    );
    expect(lookup).toHaveBeenCalledWith('cdn.example');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a hostname resolving to an IPv4-mapped loopback', async () => {
    const lookup = async () => ['::ffff:127.0.0.1'];
    expect(
      await codeOf(fetchRemoteImage('https://cdn.example/a.png', { fetchImpl: vi.fn(), lookup }))
    ).toBe('private_host');
  });

  it('refuses localhost names without a lookup', async () => {
    const lookup = vi.fn();
    expect(
      await codeOf(fetchRemoteImage('https://localhost/a.png', { fetchImpl: vi.fn(), lookup }))
    ).toBe('private_host');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('maps a DNS failure to network', async () => {
    const lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(
      await codeOf(fetchRemoteImage('https://cdn.example/a.png', { fetchImpl: vi.fn(), lookup }))
    ).toBe('network');
  });

  it('isPrivateAddress classifies public and private literals', () => {
    expect(isPrivateAddress(PUBLIC_IP)).toBe(false);
    expect(isPrivateAddress('2606:4700::6810:84e5')).toBe(false);
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('198.18.0.1')).toBe(true);
    expect(isPrivateAddress('2001:db8::1')).toBe(true);
    expect(isPrivateAddress('garbage')).toBe(true);
  });
});

describe('response guards', () => {
  const url = 'https://cdn.example/a.png';

  it('does not follow a 302 and reports redirect', async () => {
    const res = new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/x' } });
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      return res;
    }) as unknown as typeof fetch;
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup }))).toBe(
      'redirect'
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-image content-type', async () => {
    const fetchImpl = fetchReturning(
      imageResponse('<html/>', { type: 'text/html; charset=utf-8' })
    );
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup }))).toBe(
      'not_image'
    );
  });

  it('rejects a missing content-type', async () => {
    const fetchImpl = fetchReturning(imageResponse(PNG, { type: null }));
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup }))).toBe(
      'not_image'
    );
  });

  it('rejects on Content-Length above the cap before reading the body', async () => {
    // The stream primes itself once (highWaterMark 1); what matters is that
    // our code never consumes it and cancels it instead.
    const cancel = vi.fn();
    let consumed = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        consumed += 1;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel
    });
    const fetchImpl = fetchReturning(imageResponse(stream, { length: String(9 * 1024 * 1024) }));
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup }))).toBe(
      'too_large'
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(consumed).toBeLessThanOrEqual(1);
  });

  it('rejects a body that outgrows its announced Content-Length', async () => {
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Lies: says 100 bytes, streams forever.
        controller.enqueue(chunk);
        sent += chunk.length;
      }
    });
    const fetchImpl = fetchReturning(imageResponse(stream, { length: '100' }));
    const maxBytes = 1024 * 1024;
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup, maxBytes }))).toBe(
      'too_large'
    );
    // Aborted right after crossing the cap, not after draining the stream.
    expect(sent).toBeLessThan(maxBytes + 4 * chunk.length);
  });

  it('honours a custom maxBytes on the actual body', async () => {
    const fetchImpl = fetchReturning(imageResponse(Buffer.alloc(2048)));
    expect(
      await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup, maxBytes: 1024 }))
    ).toBe('too_large');
  });

  it('aborts on timeout', async () => {
    const fetchImpl = vi.fn(
      (_u: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError'))
          );
        })
    ) as unknown as typeof fetch;
    expect(
      await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup, timeoutMs: 20 }))
    ).toBe('timeout');
  });

  it('maps 404 to http', async () => {
    const fetchImpl = fetchReturning(imageResponse('gone', { status: 404, type: 'text/plain' }));
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup }))).toBe('http');
  });

  it('maps 500 to http', async () => {
    const fetchImpl = fetchReturning(imageResponse(PNG, { status: 500 }));
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup }))).toBe('http');
  });

  it('maps a thrown fetch error to network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await codeOf(fetchRemoteImage(url, { fetchImpl, lookup: publicLookup }))).toBe(
      'network'
    );
  });
});

describe('nominal', () => {
  it('returns the bytes and normalised content-type of a small PNG', async () => {
    const fetchImpl = fetchReturning(
      imageResponse(PNG, { type: 'image/png; charset=binary', length: String(PNG.length) })
    );
    const out = await fetchRemoteImage('https://cdn.example/a.png', {
      fetchImpl,
      lookup: publicLookup
    });
    expect(out.contentType).toBe('image/png');
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(out.buffer.equals(PNG)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cdn.example/a.png',
      expect.objectContaining({ redirect: 'manual', method: 'GET' })
    );
  });

  it('accepts every whitelisted image type', async () => {
    for (const type of ['image/jpeg', 'image/webp', 'image/gif', 'image/avif']) {
      const fetchImpl = fetchReturning(imageResponse(PNG, { type }));
      const out = await fetchRemoteImage('https://cdn.example/a', {
        fetchImpl,
        lookup: publicLookup
      });
      expect(out.contentType).toBe(type);
    }
  });
});
