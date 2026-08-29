import type { DiscoveryCandidate, SearchProvider } from '@/lib/leads/discovery/types';
import { isBlockedDomain } from '@/lib/leads/discovery/filters';

// ---------------------------------------------------------------------------
// Brave Search
// ---------------------------------------------------------------------------

interface BraveSearchHit {
  url: string;
  title?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveSearchHit[] };
}

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_PAGE_SIZE = 20;
// Brave caps `offset` to 9 (it's a 0-indexed page number, not a
// result offset). 10 pages × 20 results = 200 results max per query.
const BRAVE_MAX_OFFSET = 9;

export class BraveSearchProvider implements SearchProvider {
  constructor(
    private readonly query: string,
    private readonly apiKey: string,
    /** Optional ISO country code (e.g. "fr"). Brave uses this to bias
     *  results toward a market. */
    private readonly country?: string
  ) {}

  async *discover({ limit }: { limit: number }): AsyncIterable<DiscoveryCandidate> {
    let offset = 0;
    let yielded = 0;
    const seen = new Set<string>();

    while (yielded < limit && offset <= BRAVE_MAX_OFFSET) {
      const params = new URLSearchParams({
        q: this.query,
        count: String(BRAVE_PAGE_SIZE),
        offset: String(offset),
        safesearch: 'moderate'
      });
      // Brave's `country` param wants an ISO 3166 country code, not
      // an ISO 639 language code — passing "en" 422s the request.
      // Map the common language→default-market shorthands so the
      // CLI can stay language-flavoured.
      const LANG_TO_COUNTRY: Record<string, string> = {
        en: 'US',
        fr: 'FR',
        es: 'ES',
        de: 'DE',
        it: 'IT',
        pt: 'PT',
        nl: 'NL',
        pl: 'PL',
        tr: 'TR',
        ja: 'JP',
        ko: 'KR',
        zh: 'CN',
        ar: 'SA'
      };
      if (this.country) {
        const c = this.country.toUpperCase();
        const mapped = LANG_TO_COUNTRY[this.country.toLowerCase()] ?? c;
        params.set('country', mapped);
      }

      const res = await fetch(`${BRAVE_ENDPOINT}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': this.apiKey
        },
        signal: AbortSignal.timeout(20_000)
      });
      if (!res.ok) {
        throw new Error(`Brave search HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as BraveSearchResponse;
      const hits = data.web?.results ?? [];
      if (hits.length === 0) return;

      for (const h of hits) {
        if (yielded >= limit) return;
        let normalized: string;
        try {
          const u = new URL(h.url);
          // Drop path/query — discovery operates on origin, the
          // adapter takes it from there.
          normalized = `${u.protocol}//${u.hostname}`;
        } catch {
          continue;
        }
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        yield { url: normalized, source: `brave:${this.query}` };
        yielded += 1;
      }

      // Brave's free tier also rate-limits to 1 query/sec; add a tiny
      // throttle to stay below the ceiling when paginating.
      offset += 1;
      if (offset <= BRAVE_MAX_OFFSET && yielded < limit) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    }
  }
}

/**
 * Iterate a list of Brave queries (typically from `getQueryTemplates`)
 * and yield deduped candidate URLs across all of them. Used by the
 * CLI's `--platform`/`--country` mode to pump in fresh leads from a
 * coherent batch of footprints in one pass.
 */
export async function* multiBraveDiscovery(
  queries: string[],
  apiKey: string,
  country: string | undefined,
  perQueryLimit: number
): AsyncIterable<DiscoveryCandidate> {
  const seen = new Set<string>();
  for (const q of queries) {
    const provider = new BraveSearchProvider(q, apiKey, country);
    for await (const c of provider.discover({ limit: perQueryLimit })) {
      let host: string;
      try {
        host = new URL(c.url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        continue;
      }
      if (seen.has(host)) continue;
      if (isBlockedDomain(host)) continue;
      seen.add(host);
      yield c;
    }
  }
}
