import { execSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Discovery providers — sources of candidate URLs we then run through
 * the qualification pipeline. v1 ships two:
 *
 *   - SeedListProvider: read URLs from a text file (one per line).
 *     Free, no API key, useful when you already curated a list from
 *     Google or a directory.
 *
 *   - BraveSearchProvider: hit api.search.brave.com/res/v1/web/search
 *     with a query string. Brave's pricing starts at $5/mo for ~2k
 *     queries — cheap enough for solo prospection. Bing's Search API
 *     was retired in August 2025; Brave is the closest like-for-like
 *     successor.
 *
 * Adding Serper/Google CSE later is one file: implement
 * `SearchProvider` and register it in the CLI switch.
 */

export interface DiscoveryCandidate {
  url: string;
  /** Free-text label of how this candidate was found — query string,
   *  seed-file path, etc. Persisted on `leads.discoveredVia`. */
  source: string;
}

export interface SearchProvider {
  /** Async generator so a provider can paginate without buffering
   *  everything in memory. Yields a deduped stream of candidate URLs. */
  discover(opts: { limit: number }): AsyncIterable<DiscoveryCandidate>;
}

// ---------------------------------------------------------------------------
// Seed list — read URLs from a file
// ---------------------------------------------------------------------------

export class SeedListProvider implements SearchProvider {
  constructor(private readonly filePath: string) {}

  async *discover({ limit }: { limit: number }): AsyncIterable<DiscoveryCandidate> {
    const raw = await readFile(this.filePath, 'utf8');
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    let yielded = 0;
    for (const url of lines) {
      if (yielded >= limit) return;
      yield { url, source: `seed:${this.filePath}` };
      yielded += 1;
    }
  }
}

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

// ---------------------------------------------------------------------------
// Tranco Top-1M — free, daily-refreshed list of the top 1M domains
// on the web ranked by a research-grade aggregate (Cisco Umbrella +
// Majestic + Alexa Internet replacement + Cloudflare Radar). Many
// merchants sit in the long tail; the qualifier handles platform
// detection on each candidate via the existing adapters.
//
// We cache the CSV in /tmp with a 7-day TTL — the list changes
// daily but the 7-day churn at the top end is negligible and the
// download is 10 MB.
// ---------------------------------------------------------------------------

const TRANCO_URL = 'https://tranco-list.eu/top-1m.csv.zip';
const TRANCO_CACHE_DIR = join(tmpdir(), 'oneshoplab-leads');
const TRANCO_CACHE_PATH = join(TRANCO_CACHE_DIR, 'tranco-top-1m.csv');
const TRANCO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function ensureTrancoCsv(): Promise<string> {
  mkdirSync(TRANCO_CACHE_DIR, { recursive: true });
  if (existsSync(TRANCO_CACHE_PATH)) {
    const age = Date.now() - statSync(TRANCO_CACHE_PATH).mtimeMs;
    if (age < TRANCO_TTL_MS) return TRANCO_CACHE_PATH;
  }
  const zipPath = join(TRANCO_CACHE_DIR, 'tranco.zip');
  const res = await fetch(TRANCO_URL, {
    signal: AbortSignal.timeout(60_000)
  });
  if (!res.ok) {
    throw new Error(`Tranco download HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(zipPath, buf);
  // System `unzip` is universally available on Linux; bringing in
  // adm-zip / unzipper would be a deps dance for a one-shot helper.
  execSync(`unzip -po ${zipPath} > ${TRANCO_CACHE_PATH}`, { stdio: 'ignore' });
  return TRANCO_CACHE_PATH;
}

export class TrancoProvider implements SearchProvider {
  /**
   * Walk a slice of the Tranco top-1M.
   *
   * @param startRank 1-indexed rank to begin at (default 5000).
   *                  Ranks 1-5000 are dominated by infrastructure,
   *                  CDNs, news, and big-platform domains — almost no
   *                  e-commerce merchants live there. Starting at 5k
   *                  drops the noise floor without losing yield.
   * @param endRank   1-indexed rank to stop at (inclusive). Cap at 1M.
   *
   * Each domain runs ~4 HTTP probes during detect(), so the
   * (endRank - startRank) span × concurrency directly drives runtime.
   */
  constructor(
    private readonly startRank: number = 5_000,
    private readonly endRank: number = 50_000
  ) {}

  async *discover({ limit }: { limit: number }): AsyncIterable<DiscoveryCandidate> {
    const path = await ensureTrancoCsv();
    const raw = await readFile(path, 'utf8');
    const lines = raw.split('\n');
    const from = Math.max(1, this.startRank) - 1; // CSV is 0-indexed
    const to = Math.min(this.endRank, lines.length);
    let yielded = 0;
    for (let i = from; i < to && yielded < limit; i++) {
      const line = lines[i];
      if (!line) continue;
      const comma = line.indexOf(',');
      if (comma < 0) continue;
      const domain = line.slice(comma + 1).trim();
      if (!domain) continue;
      yield {
        url: `https://${domain}`,
        source: `tranco:${this.startRank}-${this.endRank}`
      };
      yielded += 1;
    }
  }
}

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

// ---------------------------------------------------------------------------
// Domains we never want to qualify — they show up in Shopify-related
// search results constantly but aren't merchants:
//   - Shopify's own properties (help, community, partners…)
//   - Aggregators / SaaS ecosystem (jotform, autods, spocket…)
//   - User-generated content sites (reddit, youtube, medium, x, …)
//   - Doc / marketing sites that *mention* shopify in the page body.
//
// Filtering at the discovery stage saves HTTP roundtrips on the
// qualifier and surfaces a much cleaner "candidates → qualified"
// conversion rate.
// ---------------------------------------------------------------------------

const BLOCKED_DOMAINS = new Set<string>([
  'shopify.com',
  'help.shopify.com',
  'community.shopify.com',
  'partners.shopify.com',
  'apps.shopify.com',
  'shop.app',
  'wix.com',
  'fr.wix.com',
  'support.wix.com',
  'wordpress.com',
  'wordpress.org',
  'woocommerce.com',
  'reddit.com',
  'medium.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'linkedin.com',
  'pinterest.com',
  'github.com',
  'stackoverflow.com',
  'quora.com',
  'play.google.com',
  'apps.apple.com',
  'wikipedia.org',
  'fr.wikipedia.org',
  'en.wikipedia.org',
  // Common Shopify ecosystem SaaS / docs / theme vendors. Extend
  // freely — false positives just mean a manual paste from the
  // operator is needed for those edge cases.
  'jotform.com',
  'autods.com',
  'spocket.co',
  'gempages.net',
  'klaviyo.com',
  'mailchimp.com',
  'gorgias.com',
  'recharge.com',
  'klarna.com',
  'shogun.com',
  'omnisend.com',
  'iubenda.com',
  'nudgify.com',
  'praella.com',
  'a2xaccounting.com',
  'zikanalytics.com',
  'valardigital.com',
  'omnithemes.com',
  'support.omnithemes.com',
  'oberlo.com',
  'paypal.com',
  'stripe.com'
]);

export function isBlockedDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (BLOCKED_DOMAINS.has(d)) return true;
  // Block all subdomains of shopify.com / wix.com / etc. with one rule.
  for (const blocked of BLOCKED_DOMAINS) {
    if (d.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Built-in query templates per platform × locale
// ---------------------------------------------------------------------------

/**
 * High-yield search query templates. Each template combines:
 *   - a platform footprint that *only* shops trigger (URL patterns
 *     like `inurl:/products/` or `inurl:/collections/` for Shopify,
 *     `inurl:/?product=` for WC, `wixsite.com` host for Wix),
 *   - a French-side or English-side cart phrase to filter out
 *     non-shop pages that happen to mention "shopify".
 *
 * The result of running all templates for a given (platform, country)
 * dedupes to a much richer candidate pool than any single query —
 * Brave caps each query at 200 results, so 5 well-chosen templates
 * scale you to ~1000 unique candidates per session.
 */
type Platform = 'shopify' | 'woocommerce' | 'wix';

// Negative keywords appended to every Shopify/WC query to filter out
// the consistent noise: agencies, training/tutorials, reviews, the
// platform's own docs, app vendors. Big yield boost on the FR market
// where the SEO is dominated by ecommerce-consultancy content.
const NEG_GENERIC =
  '-formation -agence -agency -tutoriel -tutorial -avis -review -blog -consultant -consulting -agency -prestation -services -comparatif';

const QUERY_TEMPLATES: Record<Platform, Record<string, string[]>> = {
  shopify: {
    fr: [
      // Highest precision: myshopify.com is by-definition a Shopify shop.
      'inurl:myshopify.com -inurl:help -inurl:community -inurl:partners',
      // Direct product-API endpoint: only Shopify storefronts expose it.
      'inurl:/products.json site:.fr',
      // Collection pages with a French cart phrase.
      `inurl:/collections/ "ajouter au panier" ${NEG_GENERIC}`,
      // Product pages with shipping + cart phrases.
      `inurl:/products/ "livraison" "panier" site:.fr ${NEG_GENERIC}`,
      // Native footer footprint, restricted to the FR TLD to drop
      // English-language sites that mention the phrase.
      `"propulsé par shopify" site:.fr ${NEG_GENERIC}`,
      `"powered by shopify" site:.fr ${NEG_GENERIC}`
    ],
    en: [
      'inurl:myshopify.com -inurl:help -inurl:community -inurl:partners',
      'inurl:/products.json',
      `inurl:/collections/ "add to cart" ${NEG_GENERIC}`,
      `inurl:/products/ "shipping" "checkout" ${NEG_GENERIC}`,
      `"powered by shopify" "add to cart" ${NEG_GENERIC}`
    ],
    es: [
      'inurl:myshopify.com -inurl:help -inurl:community',
      'inurl:/products.json site:.es',
      `inurl:/collections/ "añadir al carrito" ${NEG_GENERIC}`,
      `inurl:/products/ "envío" "carrito" site:.es ${NEG_GENERIC}`,
      `"con tecnología de shopify" site:.es ${NEG_GENERIC}`
    ],
    de: [
      'inurl:myshopify.com -inurl:help -inurl:community',
      'inurl:/products.json site:.de',
      `inurl:/collections/ "in den warenkorb" ${NEG_GENERIC}`,
      `inurl:/products/ "versand" "warenkorb" site:.de ${NEG_GENERIC}`,
      `"unterstützt von shopify" site:.de ${NEG_GENERIC}`
    ],
    it: [
      'inurl:myshopify.com -inurl:help -inurl:community',
      'inurl:/products.json site:.it',
      `inurl:/collections/ "aggiungi al carrello" ${NEG_GENERIC}`,
      `inurl:/products/ "spedizione" "carrello" site:.it ${NEG_GENERIC}`,
      `"sviluppato da shopify" site:.it ${NEG_GENERIC}`
    ]
  },
  woocommerce: {
    fr: [
      // ?product=ID is the WP-default permalink for products; combined
      // with the FR cart phrase it's a strong shop signal.
      `inurl:?product= "ajouter au panier" ${NEG_GENERIC}`,
      `inurl:/produit/ "ajouter au panier" site:.fr ${NEG_GENERIC}`,
      `inurl:/boutique/ "ajouter au panier" site:.fr ${NEG_GENERIC}`,
      `"propulsé par woocommerce" site:.fr ${NEG_GENERIC}`,
      `"wp-content" "woocommerce" "panier" site:.fr ${NEG_GENERIC}`
    ],
    en: [
      `inurl:?product= "add to cart" ${NEG_GENERIC}`,
      `inurl:/product/ "add to cart" "checkout" ${NEG_GENERIC}`,
      `inurl:/shop/ "add to cart" "checkout" ${NEG_GENERIC}`,
      `"proudly powered by woocommerce" ${NEG_GENERIC}`,
      `"wp-content/plugins/woocommerce" "add to cart" ${NEG_GENERIC}`
    ],
    es: [
      `inurl:?product= "añadir al carrito" ${NEG_GENERIC}`,
      `inurl:/producto/ "añadir al carrito" site:.es ${NEG_GENERIC}`,
      `inurl:/tienda/ "añadir al carrito" site:.es ${NEG_GENERIC}`,
      `"funciona con woocommerce" site:.es ${NEG_GENERIC}`
    ],
    de: [
      `inurl:?product= "in den warenkorb" ${NEG_GENERIC}`,
      `inurl:/produkt/ "in den warenkorb" site:.de ${NEG_GENERIC}`,
      `inurl:/shop/ "in den warenkorb" site:.de ${NEG_GENERIC}`,
      `"stolz präsentiert von woocommerce" site:.de ${NEG_GENERIC}`
    ],
    it: [
      `inurl:?product= "aggiungi al carrello" ${NEG_GENERIC}`,
      `inurl:/prodotto/ "aggiungi al carrello" site:.it ${NEG_GENERIC}`,
      `inurl:/negozio/ "aggiungi al carrello" site:.it ${NEG_GENERIC}`,
      `"con orgoglio basato su woocommerce" site:.it ${NEG_GENERIC}`
    ]
  },
  wix: {
    fr: [
      'site:wixsite.com "boutique" "panier"',
      'site:wixsite.com inurl:/shop',
      'site:wixsite.com inurl:/product-page'
    ],
    en: [
      'site:wixsite.com "shop" "cart"',
      'site:wixsite.com inurl:/shop',
      'site:wixsite.com inurl:/product-page',
      '"made with wix" inurl:wixsite.com'
    ],
    es: ['site:wixsite.com "tienda" "carrito"', 'site:wixsite.com inurl:/shop'],
    de: ['site:wixsite.com "shop" "warenkorb"', 'site:wixsite.com inurl:/shop'],
    it: ['site:wixsite.com "negozio" "carrello"', 'site:wixsite.com inurl:/shop']
  }
};

export function getQueryTemplates(platform: Platform, country: string | undefined): string[] {
  const lang = (country ?? 'en').toLowerCase();
  const table = QUERY_TEMPLATES[platform];
  return table[lang] ?? table['en'] ?? [];
}

// ---------------------------------------------------------------------------
// Niche-based queries
//
// Brave's index is poor on technical operators (`inurl:`, `site:` on
// platform TLDs) but rich on natural-language queries — searching for
// "boutique mode féminine en ligne" returns 10/10 real shops. Use this
// when you want to fish for real merchants without filtering by
// platform upfront (the qualifier handles platform detection on each
// candidate).
// ---------------------------------------------------------------------------

const NICHE_QUERIES: Record<string, string[]> = {
  fr: [
    'boutique mode féminine en ligne',
    'boutique mode masculine en ligne',
    'cosmétique bio boutique en ligne',
    'bijoux artisanaux boutique en ligne',
    'maison déco boutique en ligne',
    'vêtements enfants boutique en ligne',
    'équipement sport boutique en ligne',
    'alimentation bio boutique en ligne',
    'maroquinerie boutique en ligne',
    'lingerie boutique en ligne',
    'chaussures boutique en ligne',
    'accessoires mode boutique en ligne',
    'produits bébé boutique en ligne',
    'soins cheveux boutique en ligne',
    'thé café boutique en ligne'
  ],
  en: [
    'womens fashion online shop',
    'mens fashion online shop',
    'organic cosmetics online shop',
    'handmade jewelry online shop',
    'home decor online shop',
    'kids clothing online shop',
    'sports equipment online shop',
    'organic food online shop',
    'leather goods online shop',
    'lingerie online shop',
    'shoes online shop',
    'fashion accessories online shop',
    'baby products online shop',
    'hair care online shop',
    'tea coffee online shop'
  ],
  es: [
    'moda mujer tienda online',
    'moda hombre tienda online',
    'cosmética natural tienda online',
    'joyería artesanal tienda online',
    'decoración hogar tienda online',
    'ropa infantil tienda online',
    'deporte tienda online'
  ],
  de: [
    'damenmode online shop',
    'herrenmode online shop',
    'naturkosmetik online shop',
    'handgemachter schmuck online shop',
    'wohnaccessoires online shop',
    'kinderkleidung online shop',
    'sportausrüstung online shop'
  ],
  it: [
    'moda donna negozio online',
    'moda uomo negozio online',
    'cosmetica bio negozio online',
    'gioielli artigianali negozio online',
    'arredamento casa negozio online'
  ]
};

export function getNicheQueries(country: string | undefined): string[] {
  const lang = (country ?? 'en').toLowerCase();
  return NICHE_QUERIES[lang] ?? NICHE_QUERIES['en'];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  kind: 'seed' | 'brave';
  /** Path to a text file for `seed`; query string for `brave`. */
  input: string;
  /** Brave-only: bias results to a market (`fr`, `us`, …). */
  country?: string;
}

export function buildProvider(cfg: ProviderConfig): SearchProvider {
  if (cfg.kind === 'seed') return new SeedListProvider(cfg.input);
  const key = process.env.BRAVE_API_KEY;
  if (!key) {
    throw new Error(
      'BRAVE_API_KEY is not set — register at https://api-dashboard.search.brave.com/ ' +
        'and add the key to .env to use the brave provider.'
    );
  }
  return new BraveSearchProvider(cfg.input, key, cfg.country);
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
