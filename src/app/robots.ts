import type { MetadataRoute } from 'next';

const SITE_URL = process.env.APP_URL ?? 'https://oneshoplab.com';

export default function robots(): MetadataRoute.Robots {
  // The staging copy serves the same pages under a different host; indexed, it
  // would compete with production for its own name. nginx already sends a
  // noindex header there — this is the second lock, for crawlers that read
  // robots.txt first and never fetch the page.
  if (process.env.APP_ENV === 'staging') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Block authenticated areas, API routes, and Next.js internals.
        // login/signup are reachable by crawlers but won't bring SEO juice.
        // /share/* are admin-issued prospect links (case studies). Each
        // exposes one merchant's audit + AI rewrites — no SEO value to
        // us, and indexing them would leak customer-derived content.
        disallow: ['/api/', '/dashboard/', '/account/', '/share/', '/_next/']
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
