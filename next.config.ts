import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Use auto-detection (looks for ./i18n/request.ts and ./src/i18n/request.ts).
// Explicit paths breaks under Next 16 + Turbopack.
const withNextIntl = createNextIntlPlugin();

const config: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb'
    }
  },
  /**
   * Baseline security headers applied to every response. CSP is left
   * out on purpose — next-intl + dangerouslySetInnerHTML on AI
   * descriptions + Stripe Checkout + Google favicons need a careful
   * policy that we'd want to tune on a separate pass with proper
   * report-only rollout.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
          }
        ]
      }
    ];
  }
};

export default withNextIntl(config);
