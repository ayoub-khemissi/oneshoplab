export { syncProjectProducts } from './api/sync-products';
export type { SyncProductsOptions, SyncProductsResult } from './api/sync-products';
export {
  archiveProductBySourceId,
  archiveProductsNotSeen,
  countActiveProducts,
  existingSourceIds
} from './api/archive';
export type { ArchiveProductResult } from './api/archive';
export { ProjectSyncLocked, SYNC_LOCK_TIMEOUT_SEC, withProjectSyncLock } from './api/lock';
export { getCatalogState, loadProjectCatalog } from './api/catalog';
export type { CatalogState } from './api/catalog';
export { productRowToNormalized } from './lib/to-normalized';
export type { ProductRow, ProductRowToNormalizedOptions } from './lib/to-normalized';
