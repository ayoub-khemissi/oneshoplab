import { modelNamesForCopy } from '@/entities/ai-model';
import { ChevronDown } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

// The 12 Q/A keys live in the Faq namespace as q01q/q01a … q12q/q12a.
// Centralising the IDs here means the page, the JSON-LD and any future
// per-question deep-link share the same ordering.
const QIDS = [
  'q01',
  'q02',
  'q03',
  'q04',
  'q05',
  'q06',
  'q07',
  'q08',
  'q09',
  'q10',
  'q11',
  'q12'
] as const;

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Faq' });
  const languages: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${SITE_URL}/${loc}/faq`;
  }
  languages['x-default'] = `${SITE_URL}/en/faq`;
  return {
    title: t('title'),
    description: t('subtitle'),
    alternates: {
      canonical: `${SITE_URL}/${locale}/faq`,
      languages
    },
    openGraph: {
      title: `${t('title')} · OneShopLab`,
      description: t('subtitle'),
      url: `${SITE_URL}/${locale}/faq`,
      type: 'website'
    }
  };
}

export default async function FaqPage() {
  const t = await getTranslations('Faq');

  // FAQPage rich-result schema. Google indexes the text inside
  // acceptedAnswer regardless of whether the <details> element is
  // collapsed in the DOM, so we lose nothing UX-wise by defaulting to
  // closed accordions.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: QIDS.map((id) => ({
      '@type': 'Question',
      name: t(`${id}q`),
      acceptedAnswer: {
        '@type': 'Answer',
        text: t(`${id}a`, modelNamesForCopy())
      }
    }))
  };

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 md:px-6 py-12 md:py-16 flex flex-col gap-10">
      <script
        type="application/ld+json"

        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="flex flex-col items-center text-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          FAQ
        </span>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-[var(--muted)] text-base leading-relaxed max-w-xl">{t('subtitle')}</p>
      </header>

      <section className="flex flex-col gap-3" aria-label={t('title')}>
        {QIDS.map((id, idx) => (
          <details
            key={id}
            className="group rounded-lg border border-[var(--border)] bg-[var(--default)]/30 open:bg-[var(--default)]/50 transition-colors"
            // Open the first item by default so the page has visible
            // body copy on first paint — better LCP optics and signals
            // to Google that the page is content-rich, not just nav
            // chrome.
            {...(idx === 0 ? { open: true } : {})}
          >
            <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 md:px-5 py-4 text-left font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors [&::-webkit-details-marker]:hidden">
              <span className="flex-1">{t(`${id}q`)}</span>
              <ChevronDown
                className="size-4 shrink-0 text-[var(--muted)] transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="px-4 md:px-5 pb-4 -mt-1 text-sm leading-relaxed text-[var(--muted)]">
              {t(`${id}a`, modelNamesForCopy())}
            </div>
          </details>
        ))}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--default)]/30 p-6 md:p-8 flex flex-col items-center text-center gap-4">
        <h2 className="text-xl md:text-2xl font-semibold tracking-tight">{t('ctaHeading')}</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed max-w-lg">{t('ctaBody')}</p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 transition-opacity"
          >
            {t('ctaButton')}
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] px-5 py-2.5 text-sm font-medium hover:bg-[var(--default)]/60 transition-colors"
          >
            {t('ctaSignupHint')}
          </Link>
        </div>
      </section>
    </main>
  );
}
