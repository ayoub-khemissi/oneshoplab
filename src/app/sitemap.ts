import type { MetadataRoute } from 'next';
import { SUPPORTED_LOCALES } from '@/i18n/routing';
import { BLOG_POSTS, postLanguageAlternates } from '@/entities/blog';

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
  { path: '/audit', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/blog', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/faq', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.5 },
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

  // Blog articles: slugs differ per locale, so the alternates map is
  // per-article and lists ONLY the locales that have a translation —
  // never a link to a 404 variant (unlike the same-slug pages above).
  for (const post of BLOG_POSTS) {
    const { languages, xDefault } = postLanguageAlternates(post, SITE_URL);
    const alternates = { languages: { ...languages, 'x-default': xDefault } };
    for (const [loc, tr] of Object.entries(post.translations)) {
      if (!tr) continue;
      entries.push({
        url: `${SITE_URL}/${loc}/blog/${tr.slug}`,
        lastModified: new Date(post.date),
        changeFrequency: 'monthly',
        priority: 0.8,
        alternates
      });
    }
  }

  return entries;
}
