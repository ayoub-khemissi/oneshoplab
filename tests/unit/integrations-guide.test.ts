import { describe, expect, it } from 'vitest';
// Relative path on purpose: both slice entries (`index`, `client`) load next-auth /
// next-intl through the wizard, which vitest cannot resolve without a Next runtime.
import {
  adminBase,
  buildSteps,
  shopifyAdminBase
} from '../../src/features/integrations/lib/guide-steps';

describe('integrations guide admin links', () => {
  it('builds the WordPress admin URLs from the domain', () => {
    const urls = buildSteps({ platform: 'woocommerce', domain: 'ma-boutique.fr' }).map(
      (s) => s.openUrl
    );
    expect(urls).toEqual([
      'https://ma-boutique.fr/wp-admin/plugin-install.php?tab=upload',
      'https://ma-boutique.fr/wp-admin/plugins.php',
      'https://ma-boutique.fr/wp-admin/admin.php?page=oneshoplab',
      'https://ma-boutique.fr/wp-admin/admin.php?page=oneshoplab'
    ]);
  });

  it('normalises a URL with scheme, path and trailing slash', () => {
    expect(adminBase('http://Shop.Example.com/produits/?x=1')).toBe('https://shop.example.com');
    expect(adminBase('https://shop.example.com/')).toBe('https://shop.example.com');
    expect(adminBase('  ')).toBeNull();
    expect(adminBase(null)).toBeNull();
    expect(
      buildSteps({ platform: 'woocommerce', domain: null }).every((s) => s.openUrl === null)
    ).toBe(true);
  });

  it('derives the Shopify store handle from <handle>.myshopify.com', () => {
    expect(shopifyAdminBase('https://cool-shop.myshopify.com/')).toBe(
      'https://admin.shopify.com/store/cool-shop'
    );
    const steps = buildSteps({ platform: 'shopify', domain: 'cool-shop.myshopify.com' });
    expect(steps.slice(0, 4).map((s) => s.openUrl)).toEqual(
      Array(4).fill('https://admin.shopify.com/store/cool-shop/settings/apps/development')
    );
    expect(steps[4]?.openUrl).toBeNull();
  });

  it('falls back to the generic Shopify admin for a custom domain', () => {
    expect(shopifyAdminBase('www.cool-shop.com')).toBe('https://admin.shopify.com');
    expect(buildSteps({ platform: 'shopify', domain: 'cool-shop.com' })[0]?.openUrl).toBe(
      'https://admin.shopify.com/settings/apps/development'
    );
  });
});
