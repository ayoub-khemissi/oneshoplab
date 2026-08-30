import { downloadZip } from 'client-zip';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/entities/user';

/**
 * Server-side zip endpoint.
 *
 * Why this exists: our generated images live on Cloudflare R2's public
 * `*.r2.dev` host, which does NOT serve `Access-Control-Allow-Origin`
 * headers. A client-side `fetch()` from oneshoplab.com to that host is
 * blocked by the browser's CORS policy, so the previous in-browser
 * zipping path silently failed and we fell through to the "open every
 * URL in a tab" fallback — which the pop-up blocker nukes after the
 * first one. Result: clicking "Download all" only ever surfaced one
 * image.
 *
 * Server-side fetch has no CORS restriction. We pull each URL from
 * here, stream them through `client-zip` (isomorphic, uses Web
 * Streams) and the browser does a single same-origin fetch on the
 * resulting attachment — works without any R2 / Cloudflare config.
 *
 * Restrictions:
 *   - Auth required (login session). Refuses without one.
 *   - Origin allow-list: only http(s) URLs and only the project's
 *     configured R2 public host or kie.ai temp result hosts. Stops
 *     this from becoming a generic SSRF proxy.
 *   - Hard cap on URL count (10) — enough for the per-product cap of
 *     6 + a generous margin.
 */

const URL_CAP = 10;

function buildAllowedHostMatchers(): Array<(host: string) => boolean> {
  const matchers: Array<(host: string) => boolean> = [];

  // Our R2 bucket's public base(s): the canonical R2_PUBLIC_URL
  // (cdn.oneshoplab.com after the migration) plus any alias bases
  // that point at the same bucket (legacy pub-xxx.r2.dev). Exact
  // host match on each.
  for (const raw of [
    process.env.R2_PUBLIC_URL,
    ...(process.env.R2_PUBLIC_URL_ALIASES ?? '').split(',')
  ]) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      const host = new URL(v).host.toLowerCase();
      matchers.push((h) => h === host);
    } catch {
      /* ignore malformed env */
    }
  }
  // kie.ai temp hosts (jobs that completed but never made it to R2 in
  // dev / when R2 isn't configured). They live under tempfile.aiquickdraw
  // and a couple of CDN aliases — accept the .r2.dev prefix and the kie
  // CDN family.
  matchers.push((h) => h.endsWith('.r2.dev'));
  matchers.push((h) => h.endsWith('.tempfile.aiquickdraw.com'));
  matchers.push((h) => h === 'tempfile.aiquickdraw.com');

  return matchers;
}

function isAllowedUrl(raw: string, allowed: Array<(host: string) => boolean>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.host.toLowerCase();
  return allowed.some((m) => m(host));
}

function guessExtension(mime: string | null, url: string): string {
  if (mime) {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('avif')) return 'avif';
  }
  const m = url.match(/\.([a-z0-9]{3,4})(?:\?|#|$)/i);
  return m ? m[1].toLowerCase() : 'png';
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { urls?: unknown; prefix?: unknown; zipName?: unknown };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const urls = Array.isArray(body.urls)
    ? (body.urls.filter((u): u is string => typeof u === 'string') as string[])
    : [];
  const prefix =
    typeof body.prefix === 'string' && body.prefix.trim()
      ? body.prefix.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32)
      : 'image';
  const zipName =
    typeof body.zipName === 'string' && body.zipName.trim()
      ? body.zipName.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 64)
      : prefix;

  if (urls.length === 0) {
    return NextResponse.json({ error: 'no_urls' }, { status: 400 });
  }
  if (urls.length > URL_CAP) {
    return NextResponse.json({ error: 'too_many_urls', max: URL_CAP }, { status: 400 });
  }

  const allowed = buildAllowedHostMatchers();
  const filtered = urls.filter((u) => isAllowedUrl(u, allowed));
  if (filtered.length === 0) {
    return NextResponse.json({ error: 'no_allowed_urls' }, { status: 400 });
  }

  // Fetch in parallel — typically 3-6 R2 objects, latency dominates.
  // Failed individual fetches are dropped so the merchant gets whatever
  // succeeded rather than an all-or-nothing failure.
  const fetched = await Promise.allSettled(
    filtered.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
      const arrayBuffer = await res.arrayBuffer();
      return {
        url,
        contentType: res.headers.get('content-type'),
        bytes: new Uint8Array(arrayBuffer)
      };
    })
  );

  const ok: Array<{ url: string; contentType: string | null; bytes: Uint8Array }> = [];
  for (const r of fetched) {
    if (r.status === 'fulfilled') ok.push(r.value);
  }

  if (ok.length === 0) {
    return NextResponse.json({ error: 'all_fetches_failed' }, { status: 502 });
  }

  const files = ok.map((f, i) => ({
    name: `${prefix}-${i + 1}.${guessExtension(f.contentType, f.url)}`,
    input: f.bytes,
    lastModified: new Date()
  }));

  // client-zip's downloadZip returns a Response with a streaming body,
  // so we forward it directly — no buffering the full archive in
  // memory, which matters at higher resolutions (4K images can be
  // several MB each).
  const zipResponse = downloadZip(files);
  return new Response(zipResponse.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}.zip"`,
      // Prevent intermediate caching of user-specific archives.
      'Cache-Control': 'no-store'
    }
  });
}
