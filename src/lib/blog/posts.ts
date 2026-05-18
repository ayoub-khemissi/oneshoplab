import type { Locale } from '@/i18n/routing';
import productPagesFr from './content/product-pages.fr';
import productPagesEn from './content/product-pages.en';

export interface BlogTranslation {
  /** Per-locale, language-specific slug (different across locales by
   *  design — better for local SEO than one shared slug). */
  slug: string;
  /** On-page <h1> / card title. */
  title: string;
  /** <title> tag — kept distinct from the display title so the heading
   *  can stay editorial while the SERP title is keyword-led. */
  seoTitle: string;
  /** Meta + OpenGraph description and the index-card excerpt. */
  description: string;
  /** Cleaned markdown body (no front-matter, no production notes; image
   *  slots are visible "to insert" placeholders until the exported
   *  visuals are dropped in — see docs/manuel-execution P2). */
  body: string;
}

export interface BlogPost {
  /** Stable translation-group key. Ties locale variants together so
   *  hreflang is reciprocal across the SAME article, not the same slug. */
  key: string;
  /** ISO publication date. */
  date: string;
  /** Cover image under /public, or null until the export is added —
   *  the article renders fine without one meanwhile. */
  cover: string | null;
  /** Only locales we actually wrote content for. hreflang/sitemap emit
   *  ONLY these — never a link to a 404 locale variant. Interface is 13
   *  languages; blog content is FR + EN first (see SEO addendum). */
  translations: Partial<Record<Locale, BlogTranslation>>;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    key: 'product-pages-not-converting',
    date: '2026-05-18',
    cover: null,
    translations: {
      fr: {
        slug: 'fiches-produits-ne-convertissent-pas',
        title:
          "Pourquoi les fiches produits de vos clients ne convertissent pas (et comment corriger tout un catalogue en une après-midi)",
        seoTitle: 'Fiches produits qui ne convertissent pas : la solution agence',
        description:
          "Vos clients perdent des ventes à cause de fiches produits faibles. Voici comment auditer et réécrire un catalogue entier sans tout refaire à la main.",
        body: productPagesFr
      },
      en: {
        slug: 'product-pages-not-converting',
        title:
          "Why your clients' product pages aren't converting (and how to fix an entire catalog in one afternoon)",
        seoTitle: 'Product pages not converting? The agency playbook',
        description:
          "Your clients lose sales to weak product pages. Here's how to audit and rewrite an entire catalog without redoing it all by hand.",
        body: productPagesEn
      }
    }
  }
];

/** Posts that have a translation for `locale`, newest first. */
export function listPosts(
  locale: string
): Array<{ post: BlogPost; tr: BlogTranslation }> {
  return BLOG_POSTS.filter((p) => p.translations[locale as Locale])
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((post) => ({ post, tr: post.translations[locale as Locale]! }));
}

/** Resolve a (locale, slug) pair to its post + translation, or null. */
export function getPost(
  locale: string,
  slug: string
): { post: BlogPost; tr: BlogTranslation } | null {
  for (const post of BLOG_POSTS) {
    const tr = post.translations[locale as Locale];
    if (tr && tr.slug === slug) return { post, tr };
  }
  return null;
}

/**
 * hreflang map for one article: ONLY the locales that actually have a
 * translation (each pointing at its own localized slug), plus x-default.
 * Emitting hreflang to a non-existent variant is worse than none, so we
 * never widen this to all 13 the way same-slug marketing pages do.
 */
export function postLanguageAlternates(
  post: BlogPost,
  baseUrl: string
): { languages: Record<string, string>; xDefault: string } {
  const languages: Record<string, string> = {};
  for (const [loc, tr] of Object.entries(post.translations)) {
    if (!tr) continue;
    languages[loc] = `${baseUrl}/${loc}/blog/${tr.slug}`;
  }
  // x-default → English when present (Google convention), else French,
  // else whatever the single available translation is.
  const xLoc = post.translations.en ? 'en' : post.translations.fr ? 'fr' : Object.keys(post.translations)[0];
  return { languages, xDefault: languages[xLoc] };
}
