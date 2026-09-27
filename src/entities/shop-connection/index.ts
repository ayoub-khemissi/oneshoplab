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
export { shopifyAppCredentials } from './lib/app-credentials';
export { bearerFrom, signShopifyIdTokenForTests, verifyShopifyIdToken } from './lib/id-token';
export type { ShopifyIdToken } from './lib/id-token';
export {
  getWixInstance,
  installedWixInstancesFor,
  markWixInstanceLinked,
  markWixInstanceUninstalled,
  recordWixInstall
} from './api/wix-instances';
export type { WixInstanceFacts, WixInstanceRow } from './api/wix-instances';
export {
  WIX_SESSION_ISSUER,
  WIX_SESSION_TTL_SECONDS,
  isWixSessionToken,
  signWixSessionToken,
  verifyWixSessionToken,
  wixAppSecret
} from './lib/wix-session-token';
export type { WixSessionToken } from './lib/wix-session-token';
export { settleBillingChannel } from './api/billing-channel';
export type { StoreBillingChannel } from './api/billing-channel';
export {
  createAccountFromStore,
  emailTaken,
  loadStoreSummary,
  projectForStore
} from './api/store-account';
export type { StoreSummary } from './api/store-account';
export { createStoreLinkToken, maskEmail, verifyStoreLinkToken } from './lib/store-link-token';
export type { StoreLinkHost } from './lib/store-link-token';
