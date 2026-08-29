import { modelNamesForCopy } from '@/lib/ai/models';
import { Card } from '@heroui/react';
import { eq } from 'drizzle-orm';
import { ChevronDown, Coins } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CreditPackCards } from '@/components/credit-pack-cards';
import { PricingCards } from '@/components/pricing-cards';
import {
  CREDIT_PACKS,
  PLAN_TIERS,
  yearlyPriceEur,
  type BillingCycle,
  type PlanId
} from '@/lib/ai/models';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';
import { SUPPORTED_LOCALES } from '@/i18n/routing';
import { getStripePriceId } from '@/lib/stripe';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Pricing' });
  const languages: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${SITE_URL}/${loc}/pricing`;
  }
  languages['x-default'] = `${SITE_URL}/en/pricing`;
  return {
    title: t('title'),
    description: t('subtitle'),
    alternates: {
      canonical: `${SITE_URL}/${locale}/pricing`,
      languages
    },
    openGraph: {
      title: `${t('title')} · OneShopLab`,
      description: t('subtitle'),
      url: `${SITE_URL}/${locale}/pricing`,
      type: 'website'
    }
  };
}

export default async function PricingPage() {
  const t = await getTranslations('Pricing');
  const tCredits = await getTranslations('Credits');
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

  // Pull the merchant's current subscription so PricingCards can render
  // "Current plan" / "Upgrade" / "Downgrade" / "Switch cycle" rather
  // than a uniform "Subscribe" — and route those changes through the
  // customer portal instead of opening a duplicate checkout.
  let current: {
    plan: PlanId;
    cycle: BillingCycle | null;
    status: string;
  } | null = null;
  if (session?.user?.id) {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, session.user.id)
    });
    if (sub) {
      current = {
        plan: (sub.plan ?? 'free') as PlanId,
        cycle: (sub.billingCycle ?? null) as BillingCycle | null,
        status: sub.status ?? 'active'
      };
    }
  }

  // JSON-LD: surfaces the plans (subscription) + credit packs (one-time)
  // as schema.org Offers so search engines can render them as rich
  // snippets in Google Shopping / "Sponsored" results / answer boxes.
  const offerCatalog = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'OneShopLab',
    description: t('subtitle'),
    brand: { '@type': 'Brand', name: 'OneShopLab' },
    offers: [
      ...PLAN_TIERS.filter((p) => p.priceEur > 0).flatMap((p) => [
        {
          '@type': 'Offer',
          name: `${p.name} · monthly`,
          price: p.priceEur.toFixed(2),
          priceCurrency: 'EUR',
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/en/pricing`
        },
        {
          '@type': 'Offer',
          name: `${p.name} · yearly`,
          price: yearlyPriceEur(p.priceEur).toFixed(2),
          priceCurrency: 'EUR',
          availability: 'https://schema.org/InStock',
          url: `${SITE_URL}/en/pricing`
        }
      ]),
      ...CREDIT_PACKS.map((pack) => ({
        '@type': 'Offer',
        name: `${pack.name} pack · ${pack.credits.toLocaleString()} credits`,
        price: pack.priceEur.toFixed(2),
        priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
        url: `${SITE_URL}/en/account/credits`
      }))
    ]
  };

  return (
    <main className="flex-1 p-6 md:p-12 max-w-6xl w-full mx-auto flex flex-col gap-12">
      <script
        type="application/ld+json"
         
        dangerouslySetInnerHTML={{ __html: JSON.stringify(offerCatalog) }}
      />
      <header className="flex flex-col items-center text-center gap-3 max-w-2xl mx-auto">
        <span className="eyebrow">{t('eyebrow')}</span>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-lg text-[var(--muted)] leading-relaxed">{t('subtitle')}</p>
      </header>

      <PricingCards
        signedIn={signedIn}
        available={available}
        current={current}
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
          ctaUnavailable: t('ctaUnavailable'),
          ctaCurrentPlan: t('ctaCurrentPlan'),
          ctaSwitchToMonthly: t('ctaSwitchToMonthly'),
          ctaSwitchToYearly: t('ctaSwitchToYearly'),
          ctaUpgrade: t('ctaUpgrade'),
          ctaDowngrade: t('ctaDowngrade')
        }}
      />

      <section className="flex flex-col gap-3 max-w-4xl mx-auto w-full">
        <div className="flex flex-col gap-2 text-center">
          <h2 className="text-2xl font-bold tracking-tight">
            {tCredits('packsTitle')}
          </h2>
          <p className="text-sm text-[var(--muted)] max-w-2xl mx-auto leading-relaxed">
            {tCredits('packsHint')}
          </p>
        </div>
        <CreditPackCards
          copy={{
            pack: {
              boost: {
                name: tCredits('pack.boost.name'),
                tagline: tCredits('pack.boost.tagline')
              },
              power: {
                name: tCredits('pack.power.name'),
                tagline: tCredits('pack.power.tagline')
              },
              mega: {
                name: tCredits('pack.mega.name'),
                tagline: tCredits('pack.mega.tagline')
              }
            },
            creditsLabel: tCredits('packBucketLabel').toLowerCase(),
            buyLabel: tCredits('buyButton'),
            comingSoonLabel: tCredits('comingSoon'),
            perCreditLabel: (perCredit: string) => `(€${perCredit} / credit)`
          }}
        />
      </section>

      {/* "What is a credit worth?" sits below the packs because the
          packs are the primary purchase CTA on this page; the cost
          breakdown below is reference / educational copy. The id
          anchor is targeted by the home page CTA so a click there
          scrolls straight to this section. */}
      <section
        id="credits"
        className="flex flex-col gap-6 max-w-3xl mx-auto w-full scroll-mt-24"
      >
        <h2 className="text-2xl font-bold tracking-tight text-center">{t('whatIsCreditTitle')}</h2>
        <Card variant="secondary" className="p-6 flex flex-col gap-4">
          <p className="text-sm text-[var(--muted)] leading-relaxed">{t('whatIsCreditBody', modelNamesForCopy())}</p>
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
      <span className="text-lg font-semibold tabular-nums inline-flex items-center gap-1.5">
        <Coins className="size-4 text-[var(--accent)]" aria-hidden />
        {value}
      </span>
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
