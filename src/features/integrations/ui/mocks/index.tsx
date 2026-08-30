import type { ComponentType } from 'react';
import type { GuideMockId } from '../../lib/guide-steps';
import { ShopifyDevApps } from './shopify-dev-apps';
import { ShopifyInstallToken } from './shopify-install-token';
import { ShopifyScopes } from './shopify-scopes';
import { WixDashboard } from './wix-dashboard';
import { WpOslSettings } from './wp-osl-settings';
import { WpPluginsUpload } from './wp-plugins-upload';

/** One illustrative admin view per guide step (docs/api/INTEGRATION-API.md §9 "Mock views"). */
export const MOCK_VIEWS: Record<GuideMockId, ComponentType> = {
  wpUpload: () => <WpPluginsUpload variant="upload" />,
  wpActivate: () => <WpPluginsUpload variant="activate" />,
  wpPasteKey: () => <WpOslSettings variant="paste" />,
  wpSave: () => <WpOslSettings variant="save" />,
  shopifyDevApps: () => <ShopifyDevApps variant="open" />,
  shopifyCreateApp: () => <ShopifyDevApps variant="create" />,
  shopifyScopes: ShopifyScopes,
  shopifyInstall: () => <ShopifyInstallToken variant="install" />,
  shopifyPasteToken: () => <ShopifyInstallToken variant="paste" />,
  wixApps: () => <WixDashboard variant="apps" />,
  wixInstall: () => <WixDashboard variant="install" />,
  wixConsent: () => <WixDashboard variant="consent" />
};
