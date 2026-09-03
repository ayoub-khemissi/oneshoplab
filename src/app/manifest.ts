import type { MetadataRoute } from 'next';

/**
 * Web app manifest, served by Next at `/manifest.webmanifest` with the matching
 * `<link rel="manifest">` on every page. It is what makes OneShopLab
 * installable, and what the Android shell reads when the app is packaged for
 * the stores.
 *
 * One document for the whole origin, so the copy is in English — the app's
 * default locale — while `start_url` stays at the root and lets the middleware
 * route the visitor to their own language.
 */

/**
 * The app's own light background (`--background` resolved to sRGB). The system
 * bars are meant to disappear into the page rather than frame it in brand
 * colour; the dark counterpart is declared per colour scheme in the viewport
 * (`src/app/[locale]/layout.tsx`), which a manifest cannot express.
 */
export const THEME_COLOR_LIGHT = '#fafdff';
/** Same, for a phone set to dark. */
export const THEME_COLOR_DARK = '#020409';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'OneShopLab',
    short_name: 'OneShopLab',
    description:
      'Connect your store and optimise your catalog: a free audit, then AI rewrites titles, descriptions, tags and photos — you approve, it lands in your store.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'en',
    dir: 'ltr',
    background_color: THEME_COLOR_LIGHT,
    theme_color: THEME_COLOR_LIGHT,
    categories: ['business', 'productivity', 'shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ],
    shortcuts: [
      {
        name: 'Dashboard',
        short_name: 'Dashboard',
        description: 'Your stores, their scores and the changes waiting for them',
        url: '/en/dashboard',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }]
      },
      {
        name: 'Audit a store',
        short_name: 'Audit',
        description: 'Score a store catalog in about a minute',
        url: '/en/dashboard/sites/new',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }]
      }
    ]
  };
}
