import type { IntegrationPlatform } from '../model/types';

/** What the merchant copies at a step; the wizard renders it in a box with Copy. */
export type GuideValueKind = 'adminPath' | 'appName' | 'scopes' | 'siteKey';

/** Illustrative admin view rendered next to a step (ui/mocks, docs §9 "Mock views"). */
export type GuideMockId =
  | 'wpUpload'
  | 'wpActivate'
  | 'wpPasteKey'
  | 'wpSave'
  | 'shopifyDevApps'
  | 'shopifyCreateApp'
  | 'shopifyScopes'
  | 'shopifyInstall'
  | 'shopifyPasteToken';

export interface GuideStep {
  n: number;
  mock: GuideMockId;
  valueKind?: GuideValueKind;
  /** Direct link to the admin screen of this step (null when the step happens in OneShopLab). */
  openUrl: string | null;
}

type StaticStep = Omit<GuideStep, 'openUrl'>;

export const GUIDE_STEPS: Record<IntegrationPlatform, StaticStep[]> = {
  woocommerce: [
    { n: 1, mock: 'wpUpload', valueKind: 'adminPath' },
    { n: 2, mock: 'wpActivate' },
    { n: 3, mock: 'wpPasteKey', valueKind: 'siteKey' },
    { n: 4, mock: 'wpSave' }
  ],
  shopify: [
    { n: 1, mock: 'shopifyDevApps' },
    { n: 2, mock: 'shopifyCreateApp', valueKind: 'appName' },
    { n: 3, mock: 'shopifyScopes', valueKind: 'scopes' },
    { n: 4, mock: 'shopifyInstall' },
    { n: 5, mock: 'shopifyPasteToken' }
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

/** Latest plugin zip served from public/downloads by scripts/ops (versioned copy alongside). */
export const WP_PLUGIN_ZIP_PATH = '/downloads/oneshoplab-wp-plugin.zip';

/** Static values shown in the copy boxes (names exactly as in the admins). */
export const GUIDE_VALUES: Record<Exclude<GuideValueKind, 'siteKey'>, string> = {
  adminPath: '/wp-admin/plugin-install.php?tab=upload',
  appName: 'OneShopLab',
  scopes: 'read_products, write_products'
};

/**
 * `https://<host>` from whatever the project stored (`domain` or `url`):
 * scheme, path, query and trailing slash dropped, host lower-cased. Null when
 * nothing usable is known — the guide then shows no "Open" button.
 */
export function adminBase(domain: string | null | undefined): string | null {
  const raw = (domain ?? '').trim();
  if (!raw) return null;
  const host = raw
    .replace(/^[a-z]+:\/\//i, '')
    .split(/[/?#]/)[0]
    ?.toLowerCase();
  return host ? `https://${host}` : null;
}

const SHOPIFY_ADMIN = 'https://admin.shopify.com';

/** `https://admin.shopify.com/store/<handle>` for `<handle>.myshopify.com`, else the generic admin. */
export function shopifyAdminBase(domain: string | null | undefined): string {
  const host = adminBase(domain)?.slice('https://'.length);
  const handle = host?.match(/^([a-z0-9-]+)\.myshopify\.com$/)?.[1];
  return handle ? `${SHOPIFY_ADMIN}/store/${handle}` : SHOPIFY_ADMIN;
}

const WP_PATHS: Record<number, string> = {
  1: '/wp-admin/plugin-install.php?tab=upload',
  2: '/wp-admin/plugins.php',
  3: '/wp-admin/admin.php?page=oneshoplab',
  4: '/wp-admin/admin.php?page=oneshoplab'
};

/** The guide steps of a platform with each step's admin link derived from the project's domain. */
export function buildSteps({
  platform,
  domain
}: {
  platform: IntegrationPlatform;
  domain: string | null | undefined;
}): GuideStep[] {
  const base = adminBase(domain);
  const shopify = shopifyAdminBase(domain);
  return GUIDE_STEPS[platform].map((step) => {
    let openUrl: string | null = null;
    if (platform === 'woocommerce' && base) openUrl = `${base}${WP_PATHS[step.n] ?? ''}`;
    if (platform === 'shopify' && step.n <= 4) openUrl = `${shopify}/settings/apps/development`;
    return { ...step, openUrl };
  });
}
