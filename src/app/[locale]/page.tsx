import { modelNamesForCopy } from '@/lib/ai/models';
import { Card } from '@heroui/react';
import { eq } from 'drizzle-orm';
import { ArrowRight, Check, ChevronDown, PenLine, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { ShopifyLogo, WixLogo, WoocommerceLogo } from '@/components/brand-logos';
import { PricingCards } from '@/components/pricing-cards';
import { ShowcaseSection } from '@/components/showcase-section';
import { siteLimitForPlan, type BillingCycle, type PlanId } from '@/lib/ai/models';
import { launchAuditForUser, MIN_AUDIT_CREDITS, normalizeUrl } from '@/features/run-audit';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { projects, subscriptions } from '@/lib/db/schema';
import { getStripePriceId } from '@/lib/stripe';
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

  if ((session.user.creditsBalance ?? 0) < MIN_AUDIT_CREDITS) {
    redirect('/pricing?error=insufficient_credits');
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
        if ((session.user.creditsBalance ?? 0) < MIN_AUDIT_CREDITS) {
          redirect('/pricing?error=insufficient_credits');
        }
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

  // Home FAQ shows a curated subset (first 6 questions) — keeps the
  // section scrollable without overwhelming the homepage. Full list
  // lives at /faq and is linked at the bottom of the section.
  const HOME_FAQ_IDS = ['q01', 'q02', 'q03', 'q04', 'q05', 'q06'] as const;

  return (
    <main className="flex-1 relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="hero-glow" aria-hidden />
        <div className="hero-grid" aria-hidden />
        <div className="hero-spotlight" aria-hidden />
      </div>

      <section className="relative z-10 max-w-5xl w-full mx-auto px-6 py-12 md:py-16 min-h-[calc(100svh-5rem)] flex flex-col items-center justify-center text-center gap-5">
        <div className="flex flex-col items-center gap-3">
          <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)] font-mono">
            {t('compatibleWith')}
          </span>
          <div className="flex flex-wrap gap-2 justify-center">
            <span className="text-sm pl-3 pr-4 py-1.5 rounded-full bg-[var(--default)] text-[var(--default-foreground)] font-medium inline-flex items-center gap-2 border border-[var(--border)]">
              <ShopifyLogo className="size-4" />
              Shopify
            </span>
            <span className="text-sm pl-3 pr-4 py-1.5 rounded-full bg-[var(--default)] text-[var(--default-foreground)] font-medium inline-flex items-center gap-2 border border-[var(--border)]">
              <WoocommerceLogo className="size-4" />
              WooCommerce
            </span>
            <span className="text-sm pl-3 pr-4 py-1.5 rounded-full bg-[var(--default)] text-[var(--default-foreground)] font-medium inline-flex items-center gap-2 border border-[var(--border)]">
              <WixLogo className="size-4" />
              Wix
            </span>
            {/* 4th chip — signals that OneShopLab also accepts
                  manually-entered stores, so the chips row reads as
                  "works with these 3 platforms or yours" rather than
                  "only these 3". */}
            <span className="text-sm pl-3 pr-4 py-1.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium inline-flex items-center gap-2 border border-[var(--accent)]/30">
              <PenLine className="size-3.5" />
              {t('heroCompatManualChip')}
            </span>
          </div>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-[3.25rem] lg:text-6xl font-bold tracking-tight max-w-3xl leading-[1.08]">
          {t.rich('headline', {
            gradient: (chunks) => <span className="text-gradient-brand">{chunks}</span>,
            br: () => <br />
          })}
        </h1>

        <form
          action={startAuditAction}
          className="w-full max-w-xl flex flex-col items-center gap-2"
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
          <p className={`text-xs ${errorMessage ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}>
            {errorMessage ?? t('urlHint')}
          </p>
        </form>

        {/* Equal-weight alternative entry point. Centered "or" with
              flanking rules so the two CTAs read as parallel options;
              the manual CTA matches the URL button's size + shape so
              users without an existing storefront aren't pushed into
              a fallback link, they pick the path that fits them. */}
        <div className="w-full max-w-xl flex items-center gap-3" aria-hidden>
          <span className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-xs uppercase tracking-[0.2em] text-[var(--muted)] font-mono">
            {t('heroOrSeparator')}
          </span>
          <span className="flex-1 h-px bg-[var(--border)]" />
        </div>
        <Link
          // Direct hand-off — the auth middleware bounces logged-out
          // visitors through /login?next=… and back, so the link
          // works regardless of session state.
          href="/dashboard/sites/new/scratch"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[var(--surface)] border border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors font-medium text-base shadow-[0_2px_24px_-12px_oklch(0.20_0.02_250/0.18)]"
        >
          <PenLine className="size-4" />
          {t('heroScratchCta')}
          <ArrowRight className="size-4 opacity-80" aria-hidden />
        </Link>

        <p className="text-base md:text-lg text-[var(--muted)] max-w-xl leading-relaxed">
          {t('lead')}
        </p>

        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-[var(--muted)]">
          <TrustBullet>{t('trustNoSignup')}</TrustBullet>
          <TrustBullet>{t('trustNoCard')}</TrustBullet>
          <TrustBullet>{t('trustFreeCredits')}</TrustBullet>
        </ul>
      </section>

      <ShowcaseSection />

      <section className="relative z-10 max-w-5xl mx-auto px-6 py-16 md:py-24 flex flex-col gap-10">
        <div className="flex flex-col items-center text-center gap-2 max-w-2xl mx-auto">
          <span className="eyebrow">{t('howItWorksEyebrow')}</span>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('howItWorksTitle')}</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <FeatureCard number="01" title={t('step1Title')} description={t('step1Description')} />
          <FeatureCard
            number="02"
            title={t('step2Title')}
            description={t('step2Description', modelNamesForCopy())}
          />
          <FeatureCard number="03" title={t('step3Title')} description={t('step3Description')} />
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
