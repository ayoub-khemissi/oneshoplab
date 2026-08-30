// Client-safe UI of the slice (no db / next/headers in this graph).
export { ConnectionStatusCard } from './ui/connection-status-card';
export { KeyManagement } from './ui/key-management';
export { PlatformGuide } from './ui/platform-guide';
export { PlatformPicker, platformName } from './ui/platform-picker';
export { KeyReveal, SiteKeyStep } from './ui/site-key-step';
export { COMING_SOON, shopifyAdminBase } from './lib/guide-steps';
export type {
  ConnectionStatus,
  IntegrationInterestMap,
  IntegrationPlatform,
  KeyActionResult,
  SiteKeySummary
} from './model/types';
