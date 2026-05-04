import {
  SiShopify,
  SiShopifyHex,
  SiWix,
  SiWixHex,
  SiWoocommerce,
  SiWoocommerceHex
} from '@icons-pack/react-simple-icons';

/**
 * Vector logos of the e-commerce platforms we support. Sourced from
 * @icons-pack/react-simple-icons which mirrors the official Simple Icons
 * collection — paths and brand colours stay in sync with whatever the
 * platforms publish.
 *
 * Pass `monochrome` to ignore brand colour and fall back to currentColor —
 * useful when the parent context (footer, dimmed surfaces) needs uniform
 * tone instead of brand colours.
 */

interface LogoProps {
  className?: string;
  monochrome?: boolean;
}

export function ShopifyLogo({ className = 'size-5', monochrome = false }: LogoProps) {
  return (
    <SiShopify
      className={className}
      color={monochrome ? 'currentColor' : SiShopifyHex}
      aria-label="Shopify"
    />
  );
}

export function WoocommerceLogo({
  className = 'size-5',
  monochrome = false
}: LogoProps) {
  return (
    <SiWoocommerce
      className={className}
      color={monochrome ? 'currentColor' : SiWoocommerceHex}
      aria-label="WooCommerce"
    />
  );
}

export function WixLogo({ className = 'size-5', monochrome = false }: LogoProps) {
  return (
    <SiWix
      className={className}
      color={monochrome ? 'currentColor' : SiWixHex}
      aria-label="Wix"
    />
  );
}

export function PlatformLogo({
  platform,
  className,
  monochrome
}: {
  platform: 'shopify' | 'woocommerce' | 'wix';
  className?: string;
  monochrome?: boolean;
}) {
  if (platform === 'shopify') return <ShopifyLogo className={className} monochrome={monochrome} />;
  if (platform === 'woocommerce')
    return <WoocommerceLogo className={className} monochrome={monochrome} />;
  return <WixLogo className={className} monochrome={monochrome} />;
}
