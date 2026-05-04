import { Card } from '@heroui/react';
import { eq } from 'drizzle-orm';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import {
  ShopifyLogo,
  WixLogo,
  WoocommerceLogo
} from '@/components/brand-logos';
import { ShowcaseSection } from '@/components/showcase-section';
import { siteLimitForPlan } from '@/lib/ai/models';
import { launchAuditForUser, MIN_AUDIT_CREDITS, normalizeUrl } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

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
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-[3.25rem] lg:text-6xl font-bold tracking-tight max-w-3xl leading-[1.08]">
            {t.rich('headline', {
              gradient: (chunks) => <span className="text-gradient-brand">{chunks}</span>,
              br: () => <br />
            })}
          </h1>

          <form action={startAuditAction} className="w-full max-w-xl flex flex-col items-center gap-2">
            <div
              className={`relative w-full flex items-center rounded-full bg-[var(--surface)] border ${
                errorMessage ? 'border-[var(--danger)]' : 'border-[var(--border)]'
              } shadow-[0_2px_24px_-12px_oklch(0.20_0.02_250/0.18)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/15 transition-all`}
            >
              <label htmlFor="hero-url" className="sr-only">
                {t('urlLabel')}
              </label>
              <input
                id="hero-url"
                name="url"
                type="url"
                required
                placeholder="https://yourstore.com"
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
              className={`text-xs ${errorMessage ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}
            >
              {errorMessage ?? t('urlHint')}
            </p>
          </form>

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
            <FeatureCard
              number="01"
              title={t('step1Title')}
              description={t('step1Description')}
            />
            <FeatureCard
              number="02"
              title={t('step2Title')}
              description={t('step2Description')}
            />
            <FeatureCard
              number="03"
              title={t('step3Title')}
              description={t('step3Description')}
            />
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

