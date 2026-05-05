import type { MetadataRoute } from 'next';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

/**
 * Public-only sitemap. Authenticated routes (/dashboard, /account) are
 * excluded — they're noindex anyway and offer no SEO value.
 *
 * Each public page is emitted once per locale with cross-language
 * `alternates.languages` so search engines can serve the right variant
 * to the right user (hreflang). We also include an `x-default` pointer
 * to the English version per Google's recommendation.
 */
const PUBLIC_PATHS: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}> = [
  { path: '', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/terms', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'monthly', priority: 0.3 }
];

function buildLanguagesMap(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    out[loc] = `${SITE_URL}/${loc}${path}`;
  }
  // x-default (Google convention) → English variant.
  out['x-default'] = `${SITE_URL}/en${path}`;
  return out;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const { path, changeFrequency, priority } of PUBLIC_PATHS) {
    const languages = buildLanguagesMap(path);
    for (const loc of SUPPORTED_LOCALES) {
      entries.push({
        url: `${SITE_URL}/${loc}${path}`,
        lastModified,
        changeFrequency,
        priority,
        alternates: { languages }
      });
    }
  }

  return entries;
}
