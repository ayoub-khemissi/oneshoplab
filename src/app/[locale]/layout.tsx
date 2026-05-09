import { Toast } from '@heroui/react';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AuditToastWatcher } from '@/components/audit-toast-watcher';
import { CookieBanner } from '@/components/cookie-banner';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ThemeProvider } from '@/components/theme-provider';
import { RTL_LOCALES, routing, SUPPORTED_LOCALES } from '@/i18n/routing';
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'OneShopLab — AI product page optimization for Shopify, WooCommerce, Wix',
    template: '%s · OneShopLab'
  },
  description:
    'Audit your storefront in 30 seconds. Score every product on copy, visuals, catalog and tags. AI rewrites, regenerates and redesigns — with prompts you control.',
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
  alternates: {
    canonical: SITE_URL,
    languages: buildLanguageAlternates('/')
  },
  openGraph: {
    type: 'website',
    siteName: 'OneShopLab',
    title: 'OneShopLab — AI product page optimization',
    description:
      'Audit your storefront in 30 seconds. AI rewrites, regenerates and redesigns — with prompts you control.',
    url: SITE_URL,
    locale: 'en_US',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'OneShopLab — AI product page optimization'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OneShopLab — AI product page optimization',
    description:
      'Audit your storefront in 30 seconds. AI rewrites, regenerates and redesigns.',
    images: ['/opengraph-image']
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/osl-dark.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' },
      { url: '/osl-light.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' }
    ],
    shortcut: '/favicon.ico',
    apple: '/favicon.ico'
  },
  category: 'technology'
};

// All our pages depend on request-scoped data (auth cookie, DB lookups,
// search params) so we keep them dynamic.
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
        {/* JSON-LD: site identity for rich results. Kept in the body so it's
            covered by the existing CSP and emitted on every locale page. */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'OneShopLab',
              url: SITE_URL,
              logo: `${SITE_URL}/osl-dark.svg`,
              description:
                'AI product page optimization for Shopify, WooCommerce and Wix stores.',
              contactPoint: [
                {
                  '@type': 'ContactPoint',
                  email: 'support@oneshoplab.com',
                  contactType: 'customer support',
                  availableLanguage: ['English', 'French']
                }
              ]
            })
          }}
        />
        <ThemeProvider>
          <NextIntlClientProvider>
            <SiteHeader />
            <div className="flex-1 flex flex-col">{children}</div>
            <SiteFooter />
            <Toast.Provider placement="bottom end" className="bottom-8 right-8" />
            <AuditToastWatcher />
            <CookieBanner />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
