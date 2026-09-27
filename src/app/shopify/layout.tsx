import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '../globals.css';

/**
 * Root layout of the embedded home (inside the Shopify admin iframe): its own
 * root so none of the public site's analytics, cookie banner or service worker
 * end up inside the admin. App Bridge is not here: nginx injects it as the
 * first tags of <head> of every framed document, this one included
 * (scripts/ops/nginx/oneshoplab-embedded.conf, requirement 2.2.3).
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
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-[oklch(0.97_0.004_250)] text-[var(--foreground)] antialiased">
        {children}
      </body>
    </html>
  );
}
