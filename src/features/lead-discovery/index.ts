// Lead acquisition pipeline (search providers + query templates) driven by
// scripts/discover-leads.ts; qualification + persistence live in @/entities/lead.
export type { DiscoveryCandidate, SearchProvider } from './model/types';
export { SeedListProvider } from './api/seed';
export { BraveSearchProvider, multiBraveDiscovery } from './api/brave';
export { TrancoProvider } from './api/tranco';
export { CommonCrawlProvider } from './api/common-crawl';
export { getQueryTemplates, getNicheQueries } from './lib/queries';
export type { ProviderConfig } from './api/factory';
export { buildProvider } from './api/factory';
export type { AltPlatform } from './lib/alt-platforms';
export {
  ALT_PLATFORMS,
  ALT_PLATFORM_BLOCKED_DOMAINS,
  altPlatformQueries,
  detectAltPlatform,
  isAltPlatformBlocked,
  looksLikeShop
} from './lib/alt-platforms';
