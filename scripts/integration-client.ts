/**
 * Reference client for the Integration API v1 (docs/api/INTEGRATION-API.md).
 * Standalone on purpose: plugin authors can copy the `signedFetch` part.
 *
 *   pnpm tsx scripts/integration-client.ts --key osl_live_… [--base https://oneshoplab.com] site
 *   pnpm tsx scripts/integration-client.ts --key … sync '{"mode":"partial","products":[…]}'
 *   pnpm tsx scripts/integration-client.ts --key … changes [since] [limit]
 *   pnpm tsx scripts/integration-client.ts --key … ack <changeId> <applied|failed|skipped>
 *
 * `OSL_API_KEY` / `OSL_API_BASE` are read when the flags are absent.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';

function signatureHeader(key: string, method: string, path: string, body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const payload = `${t}.${method.toUpperCase()}.${path}.${bodyHash}`;
  const v1 = createHmac('sha256', key).update(payload).digest('hex');
  return `t=${t},v1=${v1}`;
}

async function signedFetch(
  base: string,
  key: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: unknown; retryAfter: string | null }> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const url = new URL(path, base);
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      'x-osl-signature': signatureHeader(key, method, url.pathname, raw),
      ...(raw ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders
    },
    body: raw || undefined
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body: keep the text */
  }
  return { status: res.status, body: parsed, retryAfter: res.headers.get('retry-after') };
}

function parseArgs(argv: string[]): { key: string; base: string; rest: string[] } {
  let key = process.env.OSL_API_KEY ?? '';
  let base = process.env.OSL_API_BASE ?? 'https://oneshoplab.com';
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--key') key = argv[++i] ?? '';
    else if (argv[i] === '--base') base = argv[++i] ?? base;
    else rest.push(argv[i]);
  }
  if (!key) throw new Error('missing --key (or OSL_API_KEY)');
  return { key, base, rest };
}

async function main(): Promise<void> {
  const { key, base, rest } = parseArgs(process.argv.slice(2));
  const [command, ...args] = rest;
  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ) => signedFetch(base, key, method, path, body, headers);

  let result;
  switch (command) {
    case 'site':
      result = await call('GET', '/api/v1/site');
      break;
    case 'sync': {
      const payload: unknown = JSON.parse(args[0] ?? '');
      result = await call('POST', '/api/v1/products/sync', payload, {
        'idempotency-key': randomUUID()
      });
      break;
    }
    case 'changes': {
      const q = new URLSearchParams();
      if (args[0]) q.set('since', args[0]);
      if (args[1]) q.set('limit', args[1]);
      const qs = q.toString();
      result = await call('GET', `/api/v1/changes${qs ? `?${qs}` : ''}`);
      break;
    }
    case 'ack': {
      const [id, status] = args;
      if (!id || !status) throw new Error('usage: ack <changeId> <applied|failed|skipped>');
      result = await call('POST', `/api/v1/changes/${encodeURIComponent(id)}/ack`, { status });
      break;
    }
    default:
      throw new Error('usage: site | sync <json> | changes [since] [limit] | ack <id> <status>');
  }
  console.info(JSON.stringify(result, null, 2));
  if (result.status >= 400) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
