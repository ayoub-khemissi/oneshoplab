import { ArrowRight, BadgeEuro, Link2, Repeat } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Affiliate' });
  const languages: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${SITE_URL}/${loc}/affiliate`;
  }
  languages['x-default'] = `${SITE_URL}/en/affiliate`;
  return {
    title: t('seoTitle'),
    description: t('seoDescription'),
    alternates: { canonical: `${SITE_URL}/${locale}/affiliate`, languages },
    openGraph: {
      title: t('seoTitle'),
      description: t('seoDescription'),
      url: `${SITE_URL}/${locale}/affiliate`,
      type: 'website'
    }
  };
}

/**
 * The affiliate programme, for creators who would recommend the product.
 *
 * Written for someone deciding whether to spend their audience's attention on
 * us: the rate, when it is paid, for how long, and what would end the
 * partnership — all of it above the fold rather than behind a form. The Terms
 * carry the binding version; this page is the honest summary of it.
 */
export default async function AffiliatePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Affiliate' });

  const steps = [
    { key: 'apply', icon: <Link2 className="size-5" aria-hidden /> },
    { key: 'share', icon: <ArrowRight className="size-5" aria-hidden /> },
    { key: 'earn', icon: <Repeat className="size-5" aria-hidden /> }
  ] as const;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 p-4 py-10 md:p-10">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">{t('eyebrow')}</span>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{t('title')}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-[var(--muted)]">{t('subtitle')}</p>
        <Link
          href="/contact?subject=affiliate"
          className="mt-2 inline-flex w-fit items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
        >
          <BadgeEuro className="size-4" aria-hidden />
          {t('cta')}
        </Link>
      </header>

      <section className="flex flex-col gap-4 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-5">
        <h2 className="text-lg font-semibold tracking-tight">{t('rateTitle')}</h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('rateBody')}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">{t('howTitle')}</h2>
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step.key} className="flex items-start gap-3">
              <span className="mt-0.5 text-[var(--accent)]">{step.icon}</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">
                  {index + 1}. {t(`step_${step.key}_title`)}
                </span>
                <span className="text-sm leading-relaxed text-[var(--muted)]">
                  {t(`step_${step.key}_body`)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{t('fitTitle')}</h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('fitBody')}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{t('rulesTitle')}</h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('rulesBody')}</p>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          <Link href="/terms" className="text-[var(--accent)] hover:underline">
            {t('rulesLink')}
          </Link>
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-6">
        <h2 className="text-xl font-semibold tracking-tight">{t('joinTitle')}</h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('joinBody')}</p>
        <Link
          href="/contact?subject=affiliate"
          className="inline-flex w-fit items-center gap-2 rounded-md border border-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10"
        >
          {t('cta')}
        </Link>
      </section>
    </main>
  );
}
