import type { MetadataRoute } from 'next';

const SITE_URL = process.env.APP_URL ?? 'https://oneshoplab.com';

export default function robots(): MetadataRoute.Robots {
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
