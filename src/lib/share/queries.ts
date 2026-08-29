/**
 * Entry point for share-link queries. The implementation is split by
 * concern (admin link listing, public /share/[token] loader, home-page
 * showcase, featured-product resolution); this module keeps the public
 * API stable for importers.
 */
export { listShareLinksForSite, listProductsWithGenerations } from '@/lib/share/admin-links';
export {
  loadSharedAudit,
  type SharedAuditSnapshot,
  type SharedProduct
} from '@/lib/share/shared-audit';
export { loadHomeShowcaseCards, type HomeShowcaseCard } from '@/lib/share/home-showcase';
