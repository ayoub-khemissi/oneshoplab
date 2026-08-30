export type {
  AdapterContext,
  FetchOptions,
  FetchProgress,
  NormalizedProduct,
  PlatformAdapter,
  PlatformDetection,
  ProductImage,
  ProductVariant
} from './model/types';
export type { DetectionResult } from './api/detect';
export { ADAPTERS, ADAPTERS_BY_NAME, CONFIDENCE_THRESHOLD, detectPlatform } from './api/detect';
export { shopifyAdapter } from './api/shopify';
export { woocommerceAdapter } from './api/woocommerce';
export { wixAdapter } from './api/wix';
export { manualAdapter } from './api/manual';
export { decodeHtmlEntities, fetchText, normalizeTags, rootOf } from './lib/fetch-utils';
