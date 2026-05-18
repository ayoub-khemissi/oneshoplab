import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { getPost, postLanguageAlternates } from '@/lib/blog/posts';
import { renderMarkdown } from '@/lib/blog/render';
import { formatDate } from '@/lib/format-date';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

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
  return {
    title: tr.seoTitle,
    description: tr.description,
    alternates: {
      canonical: url,
      languages: { ...languages, 'x-default': xDefault }
    },
    openGraph: {
      title: tr.seoTitle,
      description: tr.description,
      url,
      type: 'article',
      publishedTime: post.date
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

  return (
    <main className="flex-1 px-4 md:px-10 py-8 md:py-12 max-w-3xl w-full mx-auto flex flex-col gap-8">
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
        <time
          dateTime={post.date}
          className="text-xs font-mono uppercase tracking-wider text-[var(--muted)]"
        >
          {t('publishedOn', {
            date: formatDate(post.date)
          })}
        </time>
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
