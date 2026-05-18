import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SUPPORTED_LOCALES } from '@/i18n/routing';
import { listPosts } from '@/lib/blog/posts';
import { formatDate } from '@/lib/format-date';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Blog' });
  // The index exists for every locale (even when empty), so its hreflang
  // spans all 13 like the other marketing pages (addendum §2).
  const languages: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${SITE_URL}/${loc}/blog`;
  }
  languages['x-default'] = `${SITE_URL}/en/blog`;
  return {
    title: t('metaIndexTitle'),
    description: t('metaIndexDescription'),
    alternates: {
      canonical: `${SITE_URL}/${locale}/blog`,
      languages,
      types: {
        'application/rss+xml': `${SITE_URL}/${locale}/blog/rss.xml`
      }
    },
    openGraph: {
      title: `${t('metaIndexTitle')} · OneShopLab`,
      description: t('metaIndexDescription'),
      url: `${SITE_URL}/${locale}/blog`,
      type: 'website',
      images: [
        {
          url: '/opengraph-image',
          width: 1200,
          height: 630,
          alt: t('metaIndexTitle')
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title: t('metaIndexTitle'),
      description: t('metaIndexDescription'),
      images: ['/opengraph-image']
    }
  };
}

export default async function BlogIndexPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Blog');
  const posts = listPosts(locale);

  return (
    <main className="flex-1 px-4 md:px-10 py-10 md:py-14 max-w-3xl w-full mx-auto flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <span className="eyebrow">{t('indexEyebrow')}</span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          {t('indexTitle')}
        </h1>
        <p className="text-sm text-[var(--muted)] max-w-xl leading-relaxed">
          {t('indexSubtitle')}
        </p>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-8 text-center flex flex-col items-center gap-3">
          <p className="text-sm text-[var(--muted)]">{t('empty')}</p>
          <Link
            href="/audit"
            className="text-sm font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1.5"
          >
            {t('emptyCta')}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {posts.map(({ post, tr }) => (
            <li key={post.key}>
              <Link
                href={`/blog/${tr.slug}`}
                className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 hover:border-[var(--accent)] transition-colors group"
              >
                <time
                  dateTime={post.date}
                  className="text-xs font-mono uppercase tracking-wider text-[var(--muted)]"
                >
                  {formatDate(post.date)}
                </time>
                <h2 className="text-xl font-bold tracking-tight mt-1.5 group-hover:text-[var(--accent)] transition-colors">
                  {tr.title}
                </h2>
                <p className="text-sm text-[var(--muted)] mt-2 leading-relaxed line-clamp-2">
                  {tr.description}
                </p>
                <span className="text-sm font-medium text-[var(--accent)] mt-3 inline-flex items-center gap-1.5">
                  {t('readMore')}
                  <ArrowRight className="size-3.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
