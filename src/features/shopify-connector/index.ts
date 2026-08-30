// Server-only barrel (db + fetch): loaded by routes, server actions and the worker.
export { SHOPIFY_API_VERSION, ShopifyAdminError, createAdminClient } from './api/admin-client';
export type {
  AdminClientOptions,
  CreateMediaInput,
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
  WEBHOOK_TOPICS,
  deleteShopifyWebhooks,
  handleShopifyWebhook,
  registerShopifyWebhooks,
  webhookCallbackUrl
} from './api/webhooks';
export type { WebhookOutcome, WebhookRequest } from './api/webhooks';
export { APPLY_BATCH, applyShopifyChanges, runShopifyApplies } from './api/apply';
export type { ApplyOutcome, ApplyProjectResult } from './api/apply';
export { connectShopifyStore, disconnectShopifyStore, requestShopifyPull } from './api/validate';
export type {
  ConnectFailure,
  ConnectShopifyStoreInput,
  ConnectShopifyStoreResult
} from './api/validate';
