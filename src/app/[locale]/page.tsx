import { modelNamesForCopy } from '@/entities/ai-model';
import { Card } from '@heroui/react';
import { eq } from 'drizzle-orm';
import { ArrowRight, Check, ChevronDown, PenLine, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { ShopifyLogo, WixLogo, WoocommerceLogo } from '@/shared/ui';
import { HeroVideo } from '@/widgets/hero-video';
import { ShowcaseSection } from '@/widgets/showcase-section';
import { getStripePriceId, PricingCards } from '@/features/billing';
import { siteLimitForPlan, type BillingCycle, type PlanId } from '@/entities/ai-model';
import { launchAuditForUser, normalizeUrl } from '@/features/run-audit';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { projects, subscriptions } from '@/shared/db/schema';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const languages: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${SITE_URL}/${loc}`;
  }
  languages['x-default'] = `${SITE_URL}/en`;
  return {
    title: t('seoTitle'),
    description: t('seoDescription'),
    alternates: {
      canonical: `${SITE_URL}/${locale}`,
      languages
    },
    openGraph: {
      title: t('seoTitle'),
      description: t('seoDescription'),
      url: `${SITE_URL}/${locale}`,
      type: 'website'
    }
  };
}

async function startAuditAction(formData: FormData) {
  'use server';
  const raw = String(formData.get('url') ?? '');
  const norm = normalizeUrl(raw);
  if (!norm) {
    redirect('/?error=invalid_url');
  }

  const session = await auth();
  if (!session?.user?.id) {
    // Send anonymous users to login, carrying the URL so we can resume the
    // audit after they authenticate.
    redirect(`/login?audit=${encodeURIComponent(norm.url)}`);
  }

  // Check site quota before allowing a new project. Re-auditing an existing
  // domain doesn't count — only NEW projects do.
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session.user.id)
  });
  const alreadyHasProject = userProjects.some((p) => p.domain === norm.domain);
  if (!alreadyHasProject) {
    const limit = siteLimitForPlan(session.user.plan);
    if (userProjects.length >= limit) {
      redirect('/pricing?error=site_limit_reached');
    }
  }

  const { projectId } = await launchAuditForUser(session.user.id, norm);
  redirect(projectId ? `/dashboard/sites/${projectId}` : '/dashboard');
}

interface PageProps {
  searchParams: Promise<{ error?: string; audit?: string }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = await getTranslations('Home');
  const tPricing = await getTranslations('Pricing');
  const tFaq = await getTranslations('Faq');
  const errorMessage = params.error === 'invalid_url' ? t('errorInvalidUrl') : null;

  // Resume an audit after the user signed in. Login redirects them back to
  // `/?audit=<url>` — we pick that up here and launch the audit server-side.
  if (params.audit) {
    const session = await auth();
    if (session?.user?.id) {
      const norm = normalizeUrl(decodeURIComponent(params.audit));
      if (norm) {
        const { projectId } = await launchAuditForUser(session.user.id, norm);
        redirect(projectId ? `/dashboard/sites/${projectId}` : '/dashboard');
      }
    }
  }

  // Pricing block data prep — mirrors the /pricing page so the embedded
  // <PricingCards> can render the same CTAs (Start free / Subscribe /
  // Current plan / Upgrade …) without forcing the visitor through a
  // round-trip. Cheap calls: one auth() and one subscription lookup.
  const sessionForPricing = await auth();
  const signedIn = Boolean(sessionForPricing?.user?.id);
  const availablePlans: Record<string, boolean> = {
    starter_monthly: Boolean(getStripePriceId('starter', 'monthly')),
    starter_yearly: Boolean(getStripePriceId('starter', 'yearly')),
    pro_monthly: Boolean(getStripePriceId('pro', 'monthly')),
    pro_yearly: Boolean(getStripePriceId('pro', 'yearly')),
    scale_monthly: Boolean(getStripePriceId('scale', 'monthly')),
    scale_yearly: Boolean(getStripePriceId('scale', 'yearly'))
  };
  let currentSub: {
    plan: PlanId;
    cycle: BillingCycle | null;
    status: string;
  } | null = null;
  if (sessionForPricing?.user?.id) {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, sessionForPricing.user.id)
    });
    if (sub) {
      currentSub = {
        plan: (sub.plan ?? 'free') as PlanId,
        cycle: (sub.billingCycle ?? null) as BillingCycle | null,
        status: sub.status ?? 'active'
      };
    }
  }

  // Home FAQ shows a curated six — the ones a visitor asks before the
  // connection makes sense to them: free trial, do I install something, how
  // changes reach the store, are my originals safe, platforms, tone. Credits
  // and billing live on the full /faq page, linked below the section.
  const HOME_FAQ_IDS = ['q01', 'q04', 'q13', 'q05', 'q03', 'q02'] as const;

  return (
    <main className="flex-1 relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="hero-glow" aria-hidden />
        <div className="hero-grid" aria-hidden />
        <div className="hero-spotlight" aria-hidden />
      </div>

      <section className="relative z-10 max-w-7xl w-full mx-auto px-6 pt-4 pb-16 md:pt-10 lg:pt-12 lg:pb-20 lg:min-h-[calc(100svh-5rem)] grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] gap-10 lg:gap-12 items-center">
        <div className="@container flex flex-col items-center text-center lg:items-start lg:text-left gap-5">
          {/* Mobile keeps the original reading order — chips, headline, form,
                "or", lead, trust — via `order-*`; desktop reads eyebrow,
                headline, lead, form, with the chips under the video. */}
          <CompatChips
            className="lg:hidden"
            manualLabel={t('heroCompatManualChip')}
            label={t('compatibleWith')}
          />
          <span className="eyebrow hidden lg:inline-flex">{t('eyebrow')}</span>

          <HeroHeadline raw={t.raw('headline') as string} />

          <p className="order-4 lg:order-none text-base md:text-lg text-[var(--muted)] max-w-xl leading-relaxed">
            {t('lead')}
          </p>

          <form
            action={startAuditAction}
            className="order-2 lg:order-none w-full max-w-xl flex flex-col items-center lg:items-start gap-2"
          >
            <div
              className={`relative w-full flex items-center rounded-full bg-[var(--surface)] border ${
                errorMessage ? 'border-[var(--danger)]' : 'border-[var(--border)]'
              } shadow-[0_2px_24px_-12px_oklch(0.20_0.02_250/0.18)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/15 transition-all`}
            >
              <label htmlFor="hero-url" className="sr-only">
                {t('urlLabel')}
              </label>
              {/* type="text" not "url": native url validation rejects a
                    bare domain (no scheme) and silently blocks mobile users.
                    normalizeUrl() prepends the scheme + validates server-side. */}
              <input
                id="hero-url"
                name="url"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder={t('heroUrlPlaceholder')}
                aria-invalid={Boolean(errorMessage)}
                className="flex-1 min-w-0 px-5 sm:px-6 py-4 bg-transparent text-base outline-none rounded-full placeholder:text-[var(--field-placeholder)]"
              />
              <button
                type="submit"
                className="m-1.5 px-4 sm:px-5 py-2.5 rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Sparkles className="size-4" />
                <span className="hidden sm:inline">{t('auditButton')}</span>
                <ArrowRight className="size-4 sm:hidden" />
              </button>
            </div>
            <p
              className={`text-xs px-2 ${errorMessage ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}
            >
              {errorMessage ?? t('urlHint')}
            </p>
          </form>

          {/* Equal-weight alternative entry point for merchants without a
                storefront yet. Mobile: "or" between two rules, then a full
                pill matching the URL button; desktop: one compact line. */}
          <div className="order-3 lg:order-none w-full max-w-xl flex flex-col lg:flex-row items-center gap-4 lg:gap-3">
            <div className="w-full lg:w-auto flex items-center gap-3" aria-hidden>
              <span className="flex-1 h-px bg-[var(--border)] lg:hidden" />
              <span className="text-xs uppercase tracking-[0.2em] text-[var(--muted)] font-mono">
                {t('heroOrSeparator')}
              </span>
              <span className="flex-1 h-px bg-[var(--border)] lg:hidden" />
            </div>
            <Link
              // Direct hand-off — the auth middleware bounces logged-out
              // visitors through /login?next=… and back, so the link
              // works regardless of session state.
              href="/dashboard/sites/new/scratch"
              className="inline-flex items-center gap-2 px-5 py-3 text-base lg:px-4 lg:py-2 lg:text-sm rounded-full bg-[var(--surface)] border border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors font-medium shadow-[0_2px_24px_-12px_oklch(0.20_0.02_250/0.18)]"
            >
              <PenLine className="size-4" />
              {t('heroScratchCta')}
              <ArrowRight className="size-4 opacity-80" aria-hidden />
            </Link>
          </div>

          <ul className="order-5 lg:order-none flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 text-sm text-[var(--muted)]">
            <TrustBullet>{t('trustNoSignup')}</TrustBullet>
            <TrustBullet>{t('trustNoCard')}</TrustBullet>
            <TrustBullet>{t('trustFreeCredits')}</TrustBullet>
          </ul>
        </div>

        <div className="w-full max-w-md mx-auto lg:max-w-none flex flex-col gap-6">
          <HeroVideo
            label={t('heroVideoLabel')}
            soundOnLabel={t('heroVideoSoundOn')}
            soundOffLabel={t('heroVideoSoundOff')}
          />
          <CompatChips
            className="hidden lg:flex"
            manualLabel={t('heroCompatManualChip')}
            label={t('compatibleWith')}
          />
        </div>
      </section>

      <ShowcaseSection />

      <section className="relative z-10 max-w-5xl mx-auto px-6 py-16 md:py-24 flex flex-col gap-10">
        <div className="flex flex-col items-center text-center gap-2 max-w-2xl mx-auto">
          <span className="eyebrow">{t('howItWorksEyebrow')}</span>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('howItWorksTitle')}</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <FeatureCard number="01" title={t('step1Title')} description={t('step1Description')} />
          <FeatureCard number="02" title={t('step2Title')} description={t('step2Description')} />
          <FeatureCard
            number="03"
            title={t('step3Title')}
            description={t('step3Description', modelNamesForCopy())}
          />
        </div>
      </section>

      <section className="relative z-10 max-w-5xl mx-auto px-6 py-16 md:py-24 flex flex-col gap-10 w-full">
        <div className="flex flex-col items-center text-center gap-2 max-w-2xl mx-auto">
          <span className="eyebrow">{tPricing('eyebrow')}</span>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{tPricing('title')}</h2>
          <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed">
            {tPricing('subtitle')}
          </p>
        </div>
        <PricingCards
          signedIn={signedIn}
          available={availablePlans}
          current={currentSub}
          copy={{
            perMonth: tPricing('perMonth'),
            perMonthBilledYearly: tPricing('perMonthBilledYearly'),
            signupOnce: tPricing('signupOnce'),
            monthlyCredits: tPricing('monthlyCredits'),
            signupCredits: tPricing('signupCredits'),
            fullGenerations: tPricing('fullGenerations'),
            mostPopular: tPricing('mostPopular'),
            saveYearly: tPricing('saveYearly'),
            cycleMonthly: tPricing('cycleMonthly'),
            cycleYearly: tPricing('cycleYearly'),
            ctaStartFree: tPricing('ctaStartFree'),
            ctaSubscribe: tPricing('ctaSubscribe'),
            ctaGoToDashboard: tPricing('ctaGoToDashboard'),
            ctaUnavailable: tPricing('ctaUnavailable'),
            ctaCurrentPlan: tPricing('ctaCurrentPlan'),
            ctaSwitchToMonthly: tPricing('ctaSwitchToMonthly'),
            ctaSwitchToYearly: tPricing('ctaSwitchToYearly'),
            ctaUpgrade: tPricing('ctaUpgrade'),
            ctaDowngrade: tPricing('ctaDowngrade')
          }}
        />
        <div className="flex justify-center">
          <Link
            href="/pricing#credits"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            {tPricing('whatIsCreditTitle')}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </section>

      <section className="relative z-10 max-w-3xl mx-auto px-6 py-16 md:py-24 flex flex-col gap-10 w-full">
        <div className="flex flex-col items-center text-center gap-2 max-w-2xl mx-auto">
          <span className="eyebrow">FAQ</span>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{tFaq('title')}</h2>
          <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed">
            {tFaq('subtitle')}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {HOME_FAQ_IDS.map((id, idx) => (
            <details
              key={id}
              className="group rounded-lg border border-[var(--border)] bg-[var(--default)]/30 open:bg-[var(--default)]/50 transition-colors"
              // First item opens by default — gives the section
              // immediate visible content for both UX and SEO
              // (Google still indexes closed <details> content
              // for FAQ rich results, but visible body helps LCP).
              {...(idx === 0 ? { open: true } : {})}
            >
              <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 md:px-5 py-4 text-left font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors [&::-webkit-details-marker]:hidden">
                <span className="flex-1">{tFaq(`${id}q`)}</span>
                <ChevronDown
                  className="size-4 shrink-0 text-[var(--muted)] transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="px-4 md:px-5 pb-4 -mt-1 text-sm leading-relaxed text-[var(--muted)]">
                {tFaq(`${id}a`, modelNamesForCopy())}
              </div>
            </details>
          ))}
        </div>
        <div className="flex justify-center">
          <Link
            href="/faq"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            {tFaq('seeAll')}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </section>
    </main>
  );
}

// Width of a string in em of Geist Bold at tracking-tight, per character class —
// calibrated against browser measurements of every locale's headline (+4% margin).
function headlineEm(line: string): number {
  let em = 0;
  for (const ch of line) {
    if (/[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch)) em += 0.97;
    else if (/[\u0600-\u06ff]/.test(ch)) em += 0.42;
    else if (ch === ' ') em += 0.23;
    else if (/[.,'’!?:;]/.test(ch)) em += 0.25;
    else if (/[\u0400-\u04ff]/.test(ch)) em += ch === ch.toUpperCase() ? 0.66 : 0.58;
    else em += ch === ch.toUpperCase() ? 0.62 : 0.53;
  }
  return em * 1.04;
}

/**
 * "Connect your store. / The AI does the rest." — the first sentence always
 * holds on one line (its size shrinks to the column in long locales), the
 * gradient one may wrap, so the headline never runs past three lines.
 */
function HeroHeadline({ raw }: { raw: string }) {
  const match = raw.match(/^(.*?)<br><\/br><gradient>(.*)<\/gradient>$/);
  const first = match?.[1] ?? raw.replace(/<[^>]+>/g, ' ');
  const second = match?.[2] ?? '';
  return (
    <h1
      className="order-1 lg:order-none font-bold tracking-tight leading-[1.08] w-full [--h1-max:2.5rem] sm:[--h1-max:3rem] xl:[--h1-max:3.5rem]"
      style={{ fontSize: `min(var(--h1-max), calc(100cqi / ${headlineEm(first).toFixed(2)}))` }}
    >
      <span className="block whitespace-nowrap">{first}</span>
      {second ? <span className="block text-gradient-brand">{second}</span> : null}
    </h1>
  );
}

function CompatChips({
  label,
  manualLabel,
  className
}: {
  label: string;
  manualLabel: string;
  className: string;
}) {
  const chip =
    'text-sm pl-3 pr-4 py-1.5 rounded-full bg-[var(--default)] text-[var(--default-foreground)] font-medium inline-flex items-center gap-2 border border-[var(--border)]';
  return (
    <div className={`flex-col items-center gap-2.5 ${className}`}>
      <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)] font-mono">
        {label}
      </span>
      <div className="flex flex-wrap gap-2 justify-center">
        <span className={chip}>
          <ShopifyLogo className="size-4" />
          Shopify
        </span>
        <span className={chip}>
          <WoocommerceLogo className="size-4" />
          WooCommerce
        </span>
        <span className={chip}>
          <WixLogo className="size-4" />
          Wix
        </span>
        {/* 4th chip — signals that OneShopLab also accepts manually-entered
            stores, so the row reads as "these 3 platforms or yours". */}
        <span className="text-sm pl-3 pr-4 py-1.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium inline-flex items-center gap-2 border border-[var(--accent)]/30">
          <PenLine className="size-3.5" />
          {manualLabel}
        </span>
      </div>
    </div>
  );
}

function TrustBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <Check className="size-4 text-[var(--success)] flex-shrink-0" strokeWidth={2.5} aria-hidden />
      {children}
    </li>
  );
}

function FeatureCard({
  number,
  title,
  description
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <Card variant="secondary" className="p-6 flex flex-col gap-3">
      <span className="font-mono text-xs text-[var(--muted)] tracking-wider">{number}</span>
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-[var(--muted)] leading-relaxed">{description}</p>
    </Card>
  );
}
