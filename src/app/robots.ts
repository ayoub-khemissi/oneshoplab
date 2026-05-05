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
        disallow: ['/api/', '/dashboard/', '/account/', '/_next/']
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
