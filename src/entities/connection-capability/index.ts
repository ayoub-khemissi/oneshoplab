export { MINIMUM_CAPABILITIES, PLATFORM_CAPABILITIES } from './model/capabilities';
export { MAX_DECLARABLE_IMAGES, capabilitiesSchema, normalizeCapabilities } from './lib/schema';
export type { ReportedCapabilities } from './lib/schema';
export { getProjectCapabilities, saveReportedCapabilities } from './api/capabilities';
export { SHOPIFY_ALT_SCOPE, shopifyCapabilitiesFor } from './model/capabilities';
export { canGenerateAlt, canRunAltBatch, isMissingAlt } from './lib/alt';
export type { AltImageKind } from './lib/alt';
