import { Toast } from '@heroui/react';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Analytics, CookieBanner, GaRedirectEvents, MetaPixel } from '@/shared/analytics';
import { AuditToastWatcher } from '@/widgets/audit-toast-watcher';
import { SiteFooter } from '@/widgets/site-footer';
import { SiteHeader } from '@/widgets/site-header';
import { ThemeProvider } from '@/shared/ui';
import { ServiceWorkerRegistration, ThemeColorSync } from '@/shared/pwa';
import { getAppContactEmail } from '@/shared/config';
import { RTL_LOCALES, routing, SUPPORTED_LOCALES } from '@/i18n/routing';
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '../manifest';
import '../globals.css';
// SVG flag glyphs — Windows doesn't ship flag emoji in its system fonts,
// so the locale switcher fell back to the country code letters. flag-icons
// gives us a cross-platform <span class="fi fi-xx" /> rendering.
import 'flag-icons/css/flag-icons.min.css';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

function buildLanguageAlternates(path: string = '/'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    out[loc] = `${SITE_URL}/${loc}${path === '/' ? '' : path}`;
  }
  out['x-default'] = `${SITE_URL}/en${path === '/' ? '' : path}`;
  return out;
}

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap'
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap'
});

/**
 * Locale-aware root metadata. Per-page generateMetadata wins via the
 * `%s · OneShopLab` template, but pages without their own metadata
 * (dashboard root, /account/*) now inherit a localized title + Home
 * SEO description instead of the hardcoded English fallback. The
 * Open Graph + Twitter blocks reuse Home.seoTitle / Home.seoDescription
 * which already exist in 13 locales.
 */
export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('seoTitle'),
      template: '%s · OneShopLab'
    },
    description: t('seoDescription'),
    applicationName: 'OneShopLab',
    authors: [{ name: 'OneShopLab' }],
    generator: 'Next.js',
    keywords: [
      'Shopify SEO',
      'WooCommerce SEO',
      'Wix SEO',
      'product page optimization',
      'AI product description',
      'ecommerce audit',
      'product page rewrite',
      'AI image generation',
      'ecommerce conversion'
    ],
    referrer: 'strict-origin-when-cross-origin',
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-snippet': -1,
        'max-image-preview': 'large',
        'max-video-preview': -1
      }
    },
    ...(process.env.GSC_VERIFICATION
      ? { verification: { google: process.env.GSC_VERIFICATION } }
      : {}),
    alternates: {
      canonical: `${SITE_URL}/${locale}`,
      languages: buildLanguageAlternates('/')
    },
    openGraph: {
      type: 'website',
      siteName: 'OneShopLab',
      title: t('seoTitle'),
      description: t('seoDescription'),
      url: `${SITE_URL}/${locale}`,
      locale,
      images: [
        {
          url: '/opengraph-image',
          width: 1200,
          height: 630,
          alt: t('seoTitle')
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title: t('seoTitle'),
      description: t('seoDescription'),
      images: ['/opengraph-image']
    },
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: '32x32' },
        { url: '/osl-dark.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' },
        { url: '/osl-light.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' }
      ],
      shortcut: '/favicon.ico',
      apple: '/icons/apple-touch-icon.png'
    },
    // Added to an iPhone's home screen, the app runs without Safari's chrome
    // and keeps an opaque bar with dark glyphs above the page.
    appleWebApp: {
      capable: true,
      title: 'OneShopLab',
      statusBarStyle: 'default'
    },
    category: 'technology'
  } satisfies Metadata;
}

// All our pages depend on request-scoped data (auth cookie, DB lookups,
// search params) so we keep them dynamic.
/**
 * The system bars of the installed app. Android tints its status bar with this
 * value and Chrome derives the icon contrast from it, so it follows the app's
 * own background rather than the brand blue — a coloured bar above a white page
 * reads as a second header that belongs to nobody.
 *
 * Android's navigation bar is out of reach here: no meta and no manifest field
 * addresses it. Only the native shell can, which is why the Capacitor project
 * sets it (see `capacitor.config.ts`).
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_DARK }
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  // The notch and the home indicator are painted by the layout, so the page
  // owns the whole screen instead of stopping at the safe area.
  viewportFit: 'cover'
};

export const dynamic = 'force-dynamic';

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const dir = RTL_LOCALES.has(locale as never) ? 'rtl' : 'ltr';

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen flex flex-col antialiased font-sans">
        {/*
          Installed, the app owns the whole screen (`viewportFit: 'cover'`), so
          the strips behind the notch and under the home indicator take the
          colour of whatever the page paints there — a coloured button at the
          bottom of a form would tint the system bar. These two keep both ends
          on the app's own background, in either colour scheme.

          The top one matches the header's material rather than the raw
          background: the page below the notch is the header, and two different
          surfaces meeting there draw a visible line. The bottom one stays
          opaque — what it covers is the page background itself, which is the
          same colour, so there is no seam to avoid.
        */}
        <div
          className="fixed inset-x-0 top-0 z-50 bg-[var(--background)]/80 backdrop-blur-md"
          style={{ height: 'env(safe-area-inset-top)' }}
          aria-hidden="true"
        />
        <div
          className="fixed inset-x-0 bottom-0 z-50 bg-[var(--background)]"
          style={{ height: 'env(safe-area-inset-bottom)' }}
          aria-hidden="true"
        />
        <ServiceWorkerRegistration />
        {/* JSON-LD: site identity for rich results. Kept in the body so it's
            covered by the existing CSP and emitted on every locale page. */}
        <script
          type="application/ld+json"

          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'OneShopLab',
              url: SITE_URL,
              logo: `${SITE_URL}/osl-dark.svg`,
              description: 'AI product page optimization for Shopify, WooCommerce and Wix stores.',
              contactPoint: [
                {
                  '@type': 'ContactPoint',
                  email: getAppContactEmail(),
                  contactType: 'customer support',
                  availableLanguage: ['English', 'French']
                }
              ]
            })
          }}
        />
        <ThemeProvider>
          {/* Inside the provider: it reads the resolved theme to paint the
              system bars with what the screen actually shows. */}
          <ThemeColorSync />
          <NextIntlClientProvider>
            <SiteHeader />
            <div className="flex-1 flex flex-col">{children}</div>
            <SiteFooter />
            <Toast.Provider placement="bottom end" className="bottom-8 right-8" />
            <AuditToastWatcher />
            <CookieBanner />
            <Analytics measurementId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
            <MetaPixel pixelId={process.env.NEXT_PUBLIC_META_PIXEL_ID} />
            <GaRedirectEvents />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
