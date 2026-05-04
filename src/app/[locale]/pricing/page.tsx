import { Card } from '@heroui/react';
import { ChevronDown } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PricingCards } from '@/components/pricing-cards';
import { auth } from '@/lib/auth';
import { getStripePriceId } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const t = await getTranslations('Pricing');
  const session = await auth();
  const signedIn = Boolean(session?.user);

  // Probe which (plan, cycle) prices are configured in env so the client can
  // disable CTAs that would otherwise crash at checkout.
  const available: Record<string, boolean> = {
    starter_monthly: Boolean(getStripePriceId('starter', 'monthly')),
    starter_yearly: Boolean(getStripePriceId('starter', 'yearly')),
    pro_monthly: Boolean(getStripePriceId('pro', 'monthly')),
    pro_yearly: Boolean(getStripePriceId('pro', 'yearly')),
    scale_monthly: Boolean(getStripePriceId('scale', 'monthly')),
    scale_yearly: Boolean(getStripePriceId('scale', 'yearly'))
  };

  return (
    <main className="flex-1 p-6 md:p-12 max-w-6xl w-full mx-auto flex flex-col gap-12">
      <header className="flex flex-col items-center text-center gap-3 max-w-2xl mx-auto">
        <span className="eyebrow">{t('eyebrow')}</span>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-lg text-[var(--muted)] leading-relaxed">{t('subtitle')}</p>
      </header>

      <PricingCards
        signedIn={signedIn}
        available={available}
        copy={{
          perMonth: t('perMonth'),
          perMonthBilledYearly: t('perMonthBilledYearly'),
          signupOnce: t('signupOnce'),
          monthlyCredits: t('monthlyCredits'),
          signupCredits: t('signupCredits'),
          fullGenerations: t('fullGenerations'),
          mostPopular: t('mostPopular'),
          saveYearly: t('saveYearly'),
          cycleMonthly: t('cycleMonthly'),
          cycleYearly: t('cycleYearly'),
          ctaStartFree: t('ctaStartFree'),
          ctaSubscribe: t('ctaSubscribe'),
          ctaGoToDashboard: t('ctaGoToDashboard'),
          ctaUnavailable: t('ctaUnavailable')
        }}
      />

      <section className="flex flex-col gap-6 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-bold tracking-tight text-center">{t('whatIsCreditTitle')}</h2>
        <Card variant="secondary" className="p-6 flex flex-col gap-4">
          <p className="text-sm text-[var(--muted)] leading-relaxed">{t('whatIsCreditBody')}</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <Stat label={t('costFullGen')} value={`~50 ${t('credits')}`} />
            <Stat label={t('costImage1k')} value={`15 ${t('credits')}`} />
            <Stat label={t('costDescription')} value={`~5 ${t('credits')}`} />
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-6 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-bold tracking-tight text-center">{t('faqTitle')}</h2>
        <div className="flex flex-col gap-3">
          <FaqItem q={t('faq1Q')} a={t('faq1A')} />
          <FaqItem q={t('faq2Q')} a={t('faq2A')} />
          <FaqItem q={t('faq3Q')} a={t('faq3A')} />
          <FaqItem q={t('faq4Q')} a={t('faq4A')} />
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col justify-between items-center gap-2 rounded-md bg-[var(--background)] p-3 border border-[var(--border)] h-full text-center">
      <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-mono leading-snug">
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <Card variant="secondary" className="p-5">
      <details className="group">
        <summary className="font-medium cursor-pointer list-none flex items-center justify-between gap-3 hover:text-[var(--accent)] transition-colors">
          <span>{q}</span>
          <ChevronIcon className="size-4 transition-transform group-open:rotate-180 shrink-0" />
        </summary>
        <p className="text-sm text-[var(--muted)] leading-relaxed mt-3">{a}</p>
      </details>
    </Card>
  );
}

function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <ChevronDown className={className} aria-hidden />
  );
}
