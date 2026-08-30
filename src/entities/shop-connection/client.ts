// Client-safe entry: pure helpers + types only (index.ts opens the db).
export { SHOPIFY_DOMAIN_RE, normalizeShopDomain } from './lib/domain';
export type { ShopifyConnectionView } from './model/view';
