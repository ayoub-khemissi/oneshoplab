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
