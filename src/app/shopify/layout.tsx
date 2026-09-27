import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '../globals.css';

/**
 * Root layout of the embedded app (inside the Shopify admin iframe). Its own
 * root so App Bridge is the first script in <head>, loaded synchronously, as
 * Shopify requires (App Store requirement 2.2.3), and so none of the public
 * site's analytics, cookie banner or service worker end up inside the admin.
 */
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'], display: 'swap' });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'OneShopLab',
  robots: { index: false, follow: false }
};

export default function ShopifyEmbeddedLayout({ children }: { children: React.ReactNode }) {
  const apiKey = process.env.SHOPIFY_APP_CLIENT_ID ?? '';
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="shopify-api-key" content={apiKey} />
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- App Bridge must load first and synchronously */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </head>
      <body className="min-h-screen bg-[oklch(0.97_0.004_250)] text-[var(--foreground)] antialiased">
        {children}
      </body>
    </html>
  );
}
