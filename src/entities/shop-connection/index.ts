export type {
  ConnectShopifyInput,
  ConnectShopifyResult,
  ConnectWixInput,
  ConnectWixResult,
  DecryptedSecrets,
  DecryptedWixSecrets,
  ShopConnection,
  ShopConnectionRow,
  ShopPullProgress,
  ShopifyTokenGrant
} from './model/types';
export { SHOPIFY_DOMAIN_RE, normalizeShopDomain } from './lib/domain';
export {
  NIGHTLY_PULL_INTERVAL_MS,
  claimConnectionAlert,
  claimShopifyTokenRefresh,
  connectShopify,
  connectWix,
  disconnect,
  getConnection,
  getConnectionByInstanceId,
  getConnectionForUser,
  listDueNightlyPulls,
  listForApply,
  listRequestedPulls,
  markTokenInvalid,
  requestPull,
  revokeByShopDomain,
  revokeConnection,
  setLastError,
  setPullProgress,
  setWebhookIds,
  touchWebhook,
  withDecryptedToken,
  withDecryptedWixSecrets,
  readShopifyTokenGrant,
  releaseShopifyTokenRefresh,
  saveShopifyTokenGrant
} from './api/connections';
export { listGdprRequests, recordGdprRequest } from './api/gdpr';
export type { GdprRequestRow } from './api/gdpr';
export type { ShopifyConnectionView, WixConnectionView } from './model/view';
export { toShopifyConnectionView, toWixConnectionView } from './model/view';
export {
  deleteShopifyShop,
  getShopifyShop,
  installedShopifyShopsFor,
  markShopifyShopLinked,
  markShopifyShopUninstalled,
  openPendingGrant,
  recordShopifyInstall
} from './api/shopify-shops';
export type { ShopifyShopFacts, ShopifyShopRow } from './api/shopify-shops';
