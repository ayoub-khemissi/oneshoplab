/**
 * Entry point for lead discovery — re-exports the public API of the
 * provider modules under `./discovery/` so importers keep a single path.
 */
export type { DiscoveryCandidate, SearchProvider } from '@/lib/leads/discovery/types';
export { SeedListProvider } from '@/lib/leads/discovery/seed';
export { BraveSearchProvider, multiBraveDiscovery } from '@/lib/leads/discovery/brave';
export { TrancoProvider } from '@/lib/leads/discovery/tranco';
export { CommonCrawlProvider } from '@/lib/leads/discovery/common-crawl';
export { isBlockedDomain } from '@/lib/leads/discovery/filters';
export { getQueryTemplates, getNicheQueries } from '@/lib/leads/discovery/queries';
export type { ProviderConfig } from '@/lib/leads/discovery/factory';
export { buildProvider } from '@/lib/leads/discovery/factory';
