import { Toast } from '@heroui/react';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AuditToastWatcher } from '@/components/audit-toast-watcher';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ThemeProvider } from '@/components/theme-provider';
import { RTL_LOCALES, routing } from '@/i18n/routing';
import '../globals.css';

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
  title: 'OneShopLab — AI product page optimization for Shopify, WooCommerce, Wix',
  description:
    'Audit your storefront in 30 seconds. Score every product on copy, visuals, catalog and tags. AI rewrites, regenerates and redesigns — with prompts you control.'
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
        <ThemeProvider>
          <NextIntlClientProvider>
            <SiteHeader />
            <div className="flex-1 flex flex-col">{children}</div>
            <SiteFooter />
            <Toast.Provider placement="bottom end" className="bottom-8 right-8" />
            <AuditToastWatcher />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
