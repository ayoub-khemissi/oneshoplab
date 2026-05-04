export const ADAPTER_TIMEOUT_MS = 20_000;
export const ADAPTER_UA = 'oneshoplab-bot/0.1 (+https://oneshoplab.app)';

export interface FetchTextResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  body: string;
  contentType: string | null;
  headers: Headers | null;
}

export interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  finalUrl: string;
  headers: Headers | null;
}

export async function fetchText(url: string, init?: RequestInit): Promise<FetchTextResult> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS),
      headers: { 'User-Agent': ADAPTER_UA, ...(init?.headers as Record<string, string>) },
      redirect: 'follow',
      ...init
    });
    return {
      ok: r.ok,
      status: r.status,
      finalUrl: r.url,
      body: await r.text(),
      contentType: r.headers.get('content-type'),
      headers: r.headers
    };
  } catch {
    return { ok: false, status: 0, finalUrl: url, body: '', contentType: null, headers: null };
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<FetchJsonResult<T>> {
  const r = await fetchText(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers as Record<string, string>) }
  });
  if (!r.ok) return { ok: false, status: r.status, data: null, finalUrl: r.finalUrl, headers: r.headers };
  try {
    return {
      ok: true,
      status: r.status,
      data: JSON.parse(r.body) as T,
      finalUrl: r.finalUrl,
      headers: r.headers
    };
  } catch {
    return { ok: false, status: r.status, data: null, finalUrl: r.finalUrl, headers: r.headers };
  }
}

export function rootOf(input: string): string {
  const u = new URL(input.startsWith('http') ? input : `https://${input}`);
  return `${u.protocol}//${u.hostname}`;
}

export function normalizeTags(t: unknown): string[] {
  if (Array.isArray(t)) return t.map(String).filter(Boolean);
  if (typeof t === 'string') return t.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#0*9;/g, '\t')
    .replace(/&#0*10;/g, '\n')
    .replace(/&#0*13;/g, '\r')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'");
}
