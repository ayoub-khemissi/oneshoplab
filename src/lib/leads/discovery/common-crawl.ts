import type { DiscoveryCandidate, SearchProvider } from '@/lib/leads/discovery/types';

// ---------------------------------------------------------------------------
// Common Crawl CDX — free, no API key. Best at hostname-pattern
// discovery on the public web (e.g. every *.myshopify.com root that
// got crawled in the latest sweep). Index updates every ~3 weeks;
// each call returns a stream of NDJSON lines we filter + dedupe to
// origin URLs. Brave's coverage of these patterns is poor — CC fills
// that gap.
// ---------------------------------------------------------------------------

interface CdxRecord {
  url: string;
  status: string;
  mime?: string;
}

const CC_INDEX_LIST = 'https://index.commoncrawl.org/collinfo.json';

async function latestCcIndex(): Promise<string> {
  const res = await fetch(CC_INDEX_LIST, {
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) {
    throw new Error(`CC collinfo HTTP ${res.status}`);
  }
  const data = (await res.json()) as Array<{ id: string; 'cdx-api': string }>;
  if (data.length === 0) throw new Error('CC collinfo empty');
  return data[0]['cdx-api'];
}

export class CommonCrawlProvider implements SearchProvider {
  /**
   * @param urlPattern e.g. `*.myshopify.com` or `*.wixsite.com`
   */
  constructor(private readonly urlPattern: string) {}

  async *discover({ limit }: { limit: number }): AsyncIterable<DiscoveryCandidate> {
    const cdxApi = await latestCcIndex();
    const seen = new Set<string>();
    const patternRoot = this.urlPattern.replace(/^\*\.?/, '').toLowerCase();
    let page = 0;
    let yielded = 0;

    while (yielded < limit) {
      // Keep the URL simple — CDX gateway times out on heavy filter
      // chains. We dedupe + status-filter client-side instead.
      const url = `${cdxApi}?url=${encodeURIComponent(this.urlPattern)}&output=json&page=${page}`;

      let text: string | null = null;
      let lastErr = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(60_000),
            headers: { 'User-Agent': 'oneshoplab-leads/0.1' }
          });
          if (res.status === 404) return; // no more pages
          if (!res.ok) {
            lastErr = `HTTP ${res.status}`;
            // 504 / 503 = transient. Backoff and retry.
            if (res.status === 504 || res.status === 503 || res.status === 502) {
              await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
              continue;
            }
            // Other 4xx / 5xx → bail this page but don't crash.
            lastErr = `HTTP ${res.status}`;
            text = '';
            break;
          }
          text = await res.text();
          break;
        } catch (e) {
          lastErr = (e as Error).message;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          // 3 attempts exhausted — skip this page and move on.
          text = '';
        }
      }
      if (text === null || text === '') {
        if (lastErr) {
          process.stderr.write(`[CC] page ${page} failed: ${lastErr} — skipping\n`);
        }
        page += 1;
        await new Promise((r) => setTimeout(r, 500));
        if (page > 20) return; // hard cap to avoid runaway
        continue;
      }
      if (!text.trim()) return;

      let pageYielded = 0;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec: CdxRecord;
        try {
          rec = JSON.parse(line) as CdxRecord;
        } catch {
          continue;
        }
        // Filter client-side: only crawled HTML pages with 2xx status.
        if (rec.status && !/^2/.test(rec.status)) continue;
        if (rec.mime && !rec.mime.startsWith('text/html')) continue;

        let host: string;
        let origin: string;
        try {
          const u = new URL(rec.url);
          host = u.hostname.toLowerCase().replace(/^www\./, '');
          origin = `${u.protocol}//${u.hostname}`;
        } catch {
          continue;
        }
        if (host === patternRoot) continue;
        if (seen.has(host)) continue;
        seen.add(host);
        yield { url: origin, source: `commoncrawl:${this.urlPattern}` };
        yielded += 1;
        pageYielded += 1;
        if (yielded >= limit) return;
      }
      // Empty page = end of index for this pattern.
      if (pageYielded === 0 && text.length < 100) return;
      page += 1;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
