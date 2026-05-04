import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Use auto-detection (looks for ./i18n/request.ts and ./src/i18n/request.ts).
// Explicit paths breaks under Next 16 + Turbopack.
const withNextIntl = createNextIntlPlugin();

const config: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb'
    }
  }
};

export default withNextIntl(config);
