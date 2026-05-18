import type { Locale } from '@/i18n/routing';
import productPagesFr from './content/product-pages.fr';
import productPagesEn from './content/product-pages.en';
import catalogAuditFr from './content/catalog-audit.fr';
import catalogAuditEn from './content/catalog-audit.en';
import shopifyFr from './content/shopify-product-pages.fr';
import shopifyEn from './content/shopify-product-pages.en';
import aiDescFr from './content/ai-description-generator.fr';
import aiDescEn from './content/ai-description-generator.en';

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
  /** ISO last-modified date. Optional — falls back to `date`. Drives
   *  `dateModified` in BlogPosting JSON-LD + the OG modifiedTime, both
   *  of which Google uses for freshness. Bump it when you edit a post. */
  updated?: string;
  /** Byline / schema author. Optional — defaults to the org name. */
  author?: string;
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
    key: 'ai-product-description-generator',
    date: '2026-05-18',
    cover: null,
    translations: {
      fr: {
        slug: 'generateur-description-produit-ia-ca-marche',
        title:
          'Générateur de description produit IA : est-ce que ça marche vraiment ?',
        seoTitle:
          'Générateur de description produit IA : ça marche ?',
        description:
          "Pourquoi la plupart des générateurs IA produisent du texte inutilisable, et ce qui distingue un outil qui marche : ancrage produit, voix de marque, validation humaine, audit d'abord.",
        body: aiDescFr
      },
      en: {
        slug: 'ai-product-description-generator-does-it-work',
        title:
          'AI product description generator: does it actually work?',
        seoTitle: 'AI Product Description Generator: Does It Work?',
        description:
          'Why most AI generators produce unusable text, and what sets apart one that works: grounded in the product, brand voice, human validation, audit first.',
        body: aiDescEn
      }
    }
  },
  {
    key: 'shopify-product-page-optimization',
    date: '2026-05-18',
    cover: null,
    translations: {
      fr: {
        slug: 'optimiser-fiche-produit-shopify',
        title:
          'Optimiser une fiche produit Shopify : le guide concret (titre, description, images, tags)',
        seoTitle:
          'Optimiser une fiche produit Shopify : guide & checklist',
        description:
          "Titre, description, images, tags, bloc SEO, variantes : les 6 éléments à corriger sur une fiche produit Shopify pour qu'elle référence et convertisse — checklist incluse.",
        body: shopifyFr
      },
      en: {
        slug: 'shopify-product-page-optimization',
        title:
          'How to optimize a Shopify product page (titles, descriptions, images, tags)',
        seoTitle: 'Shopify Product Page Optimization: The Practical Guide',
        description:
          'Title, description, images, tags, SEO block, variants: the 6 elements to fix on a Shopify product page so it ranks and converts — checklist included.',
        body: shopifyEn
      }
    }
  },
  {
    key: 'ecommerce-catalog-audit',
    date: '2026-05-18',
    cover: null,
    translations: {
      fr: {
        slug: 'audit-catalogue-ecommerce-quoi-verifier',
        title:
          'Audit de catalogue e-commerce : quoi vérifier (et comment le scorer)',
        seoTitle:
          'Audit de catalogue e-commerce : la checklist complète',
        description:
          "Quels signaux vérifier produit par produit pour auditer un catalogue e-commerce — copy, visuels, complétude, tags — et comment transformer ça en score actionnable.",
        body: catalogAuditFr
      },
      en: {
        slug: 'ecommerce-catalog-audit-what-to-check',
        title:
          'Ecommerce catalog audit: what to check (and how to score it)',
        seoTitle: 'Ecommerce Catalog Audit: The Complete Checklist',
        description:
          "Which signals to check, product by product, to audit an ecommerce catalog — copy, visuals, completeness, tags — and how to turn it into an actionable score.",
        body: catalogAuditEn
      }
    }
  },
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

/** Default byline when a post doesn't override `author`. */
export const BLOG_AUTHOR = 'OneShopLab';

/** Posts that have a translation for `locale`, newest first. */
export function listPosts(
  locale: string
): Array<{ post: BlogPost; tr: BlogTranslation }> {
  return BLOG_POSTS.filter((p) => p.translations[locale as Locale])
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((post) => ({ post, tr: post.translations[locale as Locale]! }));
}

/** Other posts available in `locale`, newest first, excluding `excludeKey`.
 *  Used for the in-article "keep reading" block (internal linking). */
export function relatedPosts(
  locale: string,
  excludeKey: string,
  limit = 3
): Array<{ post: BlogPost; tr: BlogTranslation }> {
  return listPosts(locale)
    .filter(({ post }) => post.key !== excludeKey)
    .slice(0, limit);
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
