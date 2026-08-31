import type { IntegrationPlatform } from '../model/types';

/**
 * Shape of `public/downloads/oneshoplab-wp-plugin.json`, written by
 * `scripts/ops/sync-wp-plugin.sh` from the plugin repo's `compat.json`
 * (readme.txt headers as fallback). `requires`/`testedUpTo` are absent from a
 * json published before that script grew them — hence the nullable fields.
 */
export interface WpPluginManifest {
  version: string | null;
  sha256: string | null;
  builtAt: string | null;
  /** Minimum versions, comparator included (">=6.0"). */
  requires: { wordpress: string; woocommerce: string; php: string } | null;
  testedUpTo: { wordpress: string; woocommerce: string } | null;
}

/** What the guide header states about a platform; null = the line is hidden. */
export type PlatformRequirements =
  | { platform: 'woocommerce'; wordpress: string; woocommerce: string; php: string }
  | { platform: 'shopify'; adminApiVersion: string }
  | { platform: 'wix' };

export type PlatformRequirementsMap = Record<IntegrationPlatform, PlatformRequirements | null>;

/** ">=6.0" → "6.0": the manifest keeps the comparator, the tutorial shows the number. */
function minVersion(raw: string): string {
  return raw.replace(/^[\s<>=^~]+/, '').trim();
}

/** Release-coupled: the numbers move when the plugin ships, not when the app does. */
export function wooCommerceRequirements(
  manifest: WpPluginManifest | null
): PlatformRequirements | null {
  const requires = manifest?.requires;
  if (!requires) return null;
  const wordpress = minVersion(requires.wordpress);
  const woocommerce = minVersion(requires.woocommerce);
  const php = minVersion(requires.php);
  if (!wordpress || !woocommerce || !php) return null;
  return { platform: 'woocommerce', wordpress, woocommerce, php };
}

export function shopifyRequirements(adminApiVersion: string): PlatformRequirements {
  return { platform: 'shopify', adminApiVersion };
}

export function wixRequirements(): PlatformRequirements {
  return { platform: 'wix' };
}

/**
 * `adminApiVersion` is injected instead of imported: `SHOPIFY_API_VERSION`
 * lives in `features/shopify-connector`, and a feature never imports another
 * feature (eslint `no-restricted-imports`). The composition root — the site
 * view — passes the real constant, so the version is never duplicated.
 */
export function buildPlatformRequirements({
  manifest,
  shopifyApiVersion
}: {
  manifest: WpPluginManifest | null;
  shopifyApiVersion: string;
}): PlatformRequirementsMap {
  return {
    woocommerce: wooCommerceRequirements(manifest),
    shopify: shopifyRequirements(shopifyApiVersion),
    wix: wixRequirements()
  };
}
