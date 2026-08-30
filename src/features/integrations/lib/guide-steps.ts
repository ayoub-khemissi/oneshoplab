import type { IntegrationPlatform } from '../model/types';

/** What the merchant copies at a step; the wizard renders it in a box with Copy. */
export type GuideValueKind = 'adminPath' | 'appName' | 'scopes' | 'siteKey';

export interface GuideStep {
  n: number;
  valueKind?: GuideValueKind;
}

/** Screenshots live in public/integrations/<platform>/step-<n>.png (docs §9). */
export const GUIDE_STEPS: Record<IntegrationPlatform, GuideStep[]> = {
  woocommerce: [
    { n: 1, valueKind: 'adminPath' },
    { n: 2 },
    { n: 3, valueKind: 'siteKey' },
    { n: 4 }
  ],
  shopify: [
    { n: 1 },
    { n: 2, valueKind: 'appName' },
    { n: 3, valueKind: 'scopes' },
    { n: 4 },
    { n: 5 }
  ],
  wix: []
};

/** Connectors that have not shipped (spec §8 phases 3 and 5). */
export const COMING_SOON: Record<IntegrationPlatform, boolean> = {
  woocommerce: false,
  shopify: true,
  wix: true
};

export const ESTIMATED_MINUTES: Record<IntegrationPlatform, number> = {
  woocommerce: 3,
  shopify: 5,
  wix: 5
};

/** Static values shown in the copy boxes (names exactly as in the admins). */
export const GUIDE_VALUES: Record<Exclude<GuideValueKind, 'siteKey'>, string> = {
  adminPath: '/wp-admin/plugin-install.php?tab=upload',
  appName: 'OneShopLab',
  scopes: 'read_products, write_products'
};

export function screenshotPath(platform: IntegrationPlatform, n: number): string {
  return `/integrations/${platform}/step-${n}.png`;
}
