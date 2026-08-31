// Server-only barrel (db + fetch): loaded by routes, server actions and the worker.
export { SHOPIFY_API_VERSION, ShopifyAdminError, createAdminClient } from './api/admin-client';
export type {
  AdminClientOptions,
  CreateMediaInput,
  MediaMove,
  ProductUpdateInput,
  ProductsPage,
  ShopInfo,
  ShopifyAdminClient,
  ShopifyAdminErrorCode,
  WebhookTopic
} from './api/admin-client';
export {
  MEDIA_FIRST,
  PRODUCTS_PAGE_SIZE,
  PRODUCT_FIELDS_FRAGMENT,
  VARIANTS_FIRST,
  mapAdminProduct,
  productGid,
  sourceIdFromGid
} from './lib/map-product';
export type { AdminMediaImage, AdminProduct, AdminVariant, MapContext } from './lib/map-product';
export { MAX_SINGLE_QUERY_COST, projectStatus, throttleDelayMs } from './lib/throttle';
export type { CostExtension, ThrottleStatus } from './lib/throttle';
export { SHOPIFY_HMAC_HEADER, computeShopifyHmac, verifyShopifyHmac } from './lib/webhook-hmac';
export { pullShopifyCatalog, runShopifyNightlyPulls, runShopifyRequestedPulls } from './api/pull';
export type { PullResult } from './api/pull';
export {
  OAUTH_WEBHOOK_TOPICS,
  WEBHOOK_TOPICS,
  deleteShopifyWebhooks,
  handleShopifyWebhook,
  registerShopifyWebhooks,
  webhookCallbackUrl
} from './api/webhooks';
export type { WebhookOutcome, WebhookRequest } from './api/webhooks';
export { CAPABILITIES, createShopifyImageOps } from './api/image-ops';
export { APPLY_BATCH, applyShopifyChanges, runShopifyApplies } from './api/apply';
export type { ApplyOutcome, ApplyProjectResult } from './api/apply';
export { connectShopifyStore, disconnectShopifyStore, requestShopifyPull } from './api/validate';
export type {
  ConnectFailure,
  ConnectShopifyStoreInput,
  ConnectShopifyStoreResult
} from './api/validate';
export {
  DEFAULT_SHOPIFY_APP_SCOPES,
  SHOPIFY_STATE_COOKIE,
  computeShopifyQueryHmac,
  isShopifyAppConfigured,
  missingScopes,
  shopifyAppConfig,
  shopifyAuthorizeUrl,
  verifyShopifyQueryHmac
} from './lib/oauth';
export type { ShopifyAppConfig } from './lib/oauth';
export { beginShopifyInstall, completeShopifyInstall, shopifyRedirectUri } from './api/oauth';
export type {
  BeginShopifyInstallResult,
  CompleteShopifyInstallFailure,
  CompleteShopifyInstallResult
} from './api/oauth';
export { GDPR_ROUTE_TOPICS, handleShopifyGdprWebhook } from './api/gdpr';
export type { GdprOutcome } from './api/gdpr';
