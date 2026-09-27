import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '../globals.css';

/**
 * Root layout of the Wix dashboard page (inside the Wix dashboard iframe):
 * its own root so none of the public site's analytics, cookie banner or
 * service worker end up inside the dashboard. No App Bridge here — that is
 * Shopify's; nginx only injects it outside /wix.
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

export default function WixEmbeddedLayout({ children }: { children: React.ReactNode }) {
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
