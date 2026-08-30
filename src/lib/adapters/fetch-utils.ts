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
  if (!r.ok)
    return { ok: false, status: r.status, data: null, finalUrl: r.finalUrl, headers: r.headers };
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
  if (typeof t === 'string')
    return t
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

// A few named entities WordPress/WooCommerce emit on titles & taxonomies.
// We don't ship the full HTML5 table (~2k entries) — these cover everything
// the adapters surface in practice. Add to this map if a real product
// title shows up undecoded.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  // Latin-1 letters WooCommerce/WordPress still emit on some setups
  // ("Caf&eacute;") — without these a French title reaches the audit and
  // the AI prompts with raw entities.
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  auml: 'ä',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  ouml: 'ö',
  oelig: 'œ',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  Agrave: 'À',
  Eacute: 'É',
  Egrave: 'È',
  Ccedil: 'Ç',
  szlig: 'ß'
};

/**
 * Decode the HTML entities WooCommerce / WordPress emit on product
 * titles and taxonomy names. Handles:
 *   - decimal numeric refs: `&#8211;`  → "–"
 *   - hex numeric refs:     `&#x2013;` → "–"
 *   - the named entities above (incl. typographic quotes + dashes,
 *     which WordPress's `wptexturize` inserts into Latin-1 sources).
 *
 * Numeric refs are decoded first so a hand-crafted `&amp;#8211;`
 * (entity inside an entity) resolves to `&#8211;` then "–" rather
 * than `&` + `#8211;` — matches what browsers do.
 */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return _;
      }
    })
    .replace(/&([a-z]+);/gi, (raw, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? raw);
}
