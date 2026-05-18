import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import {
  BLOG_AUTHOR,
  getPost,
  postLanguageAlternates,
  relatedPosts,
  type BlogPost
} from '@/lib/blog/posts';
import { renderMarkdown } from '@/lib/blog/render';
import { formatDate } from '@/lib/format-date';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

/** Absolute URL for a post's social/share image — its cover when set,
 *  otherwise the site-wide OG image route. Schema.org + OG need absolute. */
function ogImageFor(post: BlogPost): string {
  if (!post.cover) return `${SITE_URL}/opengraph-image`;
  return post.cover.startsWith('http')
    ? post.cover
    : `${SITE_URL}${post.cover.startsWith('/') ? '' : '/'}${post.cover}`;
}

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const found = getPost(locale, slug);
  if (!found) return { title: 'Article', robots: { index: false, follow: false } };
  const { post, tr } = found;
  const { languages, xDefault } = postLanguageAlternates(post, SITE_URL);
  const url = `${SITE_URL}/${locale}/blog/${tr.slug}`;
  const image = ogImageFor(post);
  const author = post.author ?? BLOG_AUTHOR;
  return {
    title: tr.seoTitle,
    description: tr.description,
    authors: [{ name: author }],
    alternates: {
      canonical: url,
      languages: { ...languages, 'x-default': xDefault }
    },
    openGraph: {
      title: tr.seoTitle,
      description: tr.description,
      url,
      type: 'article',
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [author],
      images: [{ url: image, width: 1200, height: 630, alt: tr.title }]
    },
    twitter: {
      card: 'summary_large_image',
      title: tr.seoTitle,
      description: tr.description,
      images: [image]
    }
  };
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const found = getPost(locale, slug);
  if (!found) notFound();
  const { post, tr } = found;

  const t = await getTranslations('Blog');
  const html = renderMarkdown(tr.body);

  const url = `${SITE_URL}/${locale}/blog/${tr.slug}`;
  const image = ogImageFor(post);
  const author = post.author ?? BLOG_AUTHOR;
  const modified = post.updated ?? post.date;
  const related = relatedPosts(locale, post.key);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      url,
      headline: tr.title,
      description: tr.description,
      inLanguage: locale,
      datePublished: post.date,
      dateModified: modified,
      image: [image],
      author: { '@type': 'Organization', name: author, url: SITE_URL },
      publisher: {
        '@type': 'Organization',
        name: 'OneShopLab',
        url: SITE_URL,
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/osl-dark.svg` }
      }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'OneShopLab',
          item: `${SITE_URL}/${locale}`
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: t('indexEyebrow'),
          item: `${SITE_URL}/${locale}/blog`
        },
        { '@type': 'ListItem', position: 3, name: tr.title, item: url }
      ]
    }
  ];

  return (
    <main className="flex-1 px-4 md:px-10 py-8 md:py-12 max-w-3xl w-full mx-auto flex flex-col gap-8">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div>
        <Link
          href="/blog"
          className="text-xs font-medium text-[var(--muted)] hover:text-[var(--accent)] inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          {t('backToBlog')}
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono uppercase tracking-wider text-[var(--muted)]">
          <time dateTime={post.date}>
            {t('publishedOn', { date: formatDate(post.date) })}
          </time>
          {modified !== post.date ? (
            <>
              <span aria-hidden>·</span>
              <time dateTime={modified}>
                {t('updatedOn', { date: formatDate(modified) })}
              </time>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>{author}</span>
        </div>
        <h1 className="text-3xl md:text-[2.5rem] font-bold tracking-tight leading-[1.12]">
          {tr.title}
        </h1>
        <p className="text-base text-[var(--muted)] leading-relaxed">
          {tr.description}
        </p>
      </header>

      {/* First-party repo content (src/lib/blog/content/*) → trusted HTML,
          same model as the /share AI-HTML render. Wrapped in `prose` for
          the shared typographic spacing. */}
      <article
        className="prose max-w-none"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {related.length > 0 ? (
        <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-6">
          <h2 className="text-lg font-bold tracking-tight">
            {t('relatedTitle')}
          </h2>
          <ul className="flex flex-col gap-2">
            {related.map(({ post: rp, tr: rt }) => (
              <li key={rp.key}>
                <Link
                  href={`/blog/${rt.slug}`}
                  className="group flex flex-col gap-0.5 rounded-md border border-[var(--border)] p-4 hover:border-[var(--accent)] transition-colors"
                >
                  <span className="font-medium group-hover:text-[var(--accent)] transition-colors">
                    {rt.title}
                  </span>
                  <span className="text-xs text-[var(--muted)] line-clamp-2">
                    {rt.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 flex flex-col items-center gap-3 text-center">
        <Sparkles className="size-6 text-[var(--accent)]" aria-hidden />
        <h2 className="text-xl font-bold tracking-tight">{t('ctaTitle')}</h2>
        <Link
          href="/audit"
          className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 inline-flex items-center gap-1.5 mt-1"
        >
          {t('ctaButton')}
          <ArrowRight className="size-3.5" />
        </Link>
        <p className="text-xs text-[var(--muted)]">{t('ctaNote')}</p>
      </section>
    </main>
  );
}
