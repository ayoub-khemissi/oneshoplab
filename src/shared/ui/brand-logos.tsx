/**
 * Vector logos of the e-commerce platforms we support. Sourced as
 * static SVGs in `public/brand/` (shipped from this repo, no CDN
 * dependency) so we don't rely on a third-party icon package.
 *
 * Brand colours are baked into the SVGs themselves — no `monochrome`
 * variant. If a context needs a flat tone (e.g. a dim footer), wrap
 * the logo in a div with a CSS filter rather than re-render the
 * vector.
 */

interface LogoProps {
  className?: string;
}

export function ShopifyLogo({ className = 'size-5' }: LogoProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/shopify.svg" alt="Shopify" className={className} />;
}

export function WoocommerceLogo({ className = 'size-5' }: LogoProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/woocommerce.svg" alt="WooCommerce" className={className} />;
}

export function WixLogo({ className = 'size-5' }: LogoProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/wix.svg" alt="Wix" className={className} />;
}

export function PlatformLogo({
  platform,
  className
}: {
  platform: 'shopify' | 'woocommerce' | 'wix';
  className?: string;
}) {
  if (platform === 'shopify') return <ShopifyLogo className={className} />;
  if (platform === 'woocommerce') return <WoocommerceLogo className={className} />;
  return <WixLogo className={className} />;
}
