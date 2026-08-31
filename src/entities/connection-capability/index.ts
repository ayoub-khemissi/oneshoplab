export { MINIMUM_CAPABILITIES, PLATFORM_CAPABILITIES } from './model/capabilities';
export { MAX_DECLARABLE_IMAGES, capabilitiesSchema, normalizeCapabilities } from './lib/schema';
export type { ReportedCapabilities } from './lib/schema';
export { getProjectCapabilities, saveReportedCapabilities } from './api/capabilities';
