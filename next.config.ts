import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Use auto-detection (looks for ./i18n/request.ts and ./src/i18n/request.ts).
// Explicit paths breaks under Next 16 + Turbopack.
const withNextIntl = createNextIntlPlugin();

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.google.com https://www.gstatic.com https://www.googletagmanager.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https://cdn.oneshoplab.com https://*.r2.dev",
  "connect-src 'self' https://api.stripe.com https://*.stripe.com https://www.google.com https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://www.facebook.com https://connect.facebook.net https://cdn.oneshoplab.com https://*.r2.dev",
  'frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://www.google.com https://recaptcha.google.com',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://accounts.google.com",
  'report-uri /api/csp-report'
].join('; ');

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
   * Baseline security headers applied to every response. CSP ships in
   * REPORT-ONLY mode: violations are POSTed to /api/csp-report and logged,
   * nothing is blocked. Enforce it (rename the header) only after a quiet
   * week of logs. Known constraints baked into the policy: Next inline
   * bootstrap scripts + next-intl need 'unsafe-inline' without a nonce
   * pipeline, dangerouslySetInnerHTML on AI descriptions, Stripe
   * Checkout/JS, reCAPTCHA, GA4 + Meta pixel, Google favicons, R2 CDN.
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
          },
          { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY }
        ]
      }
    ];
  }
};

export default withNextIntl(config);
