import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OneShopLab',
    short_name: 'OneShopLab',
    description:
      'AI product page optimization for Shopify, WooCommerce and Wix stores. Audit, score, rewrite, redesign.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0a84ff',
    icons: [
      {
        src: '/osl-dark.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any'
      }
    ]
  };
}
