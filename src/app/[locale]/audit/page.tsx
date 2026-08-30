import { ArrowRight, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ShopifyLogo, WixLogo, WoocommerceLogo } from '@/components/brand-logos';
import { Link } from '@/i18n/navigation';
import { launchAnonymousAudit, normalizeUrl } from '@/features/run-audit';
import {
  isRecaptchaEnabled,
  RecaptchaLegalNotice,
  RecaptchaWrapper,
  verifyRecaptcha
} from '@/shared/recaptcha';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'FreeAudit' });
  // Self-referential canonical + reciprocal hreflang + x-default — the
  // pattern the multilingual SEO addendum (§2) requires for every public
  // page. This page IS a primary SEO/acquisition asset, so it must carry
  // its own metadata rather than inherit the root layout's home canonical.
  // Slug is a single neutral token across all 13 locales (no next-intl
  // pathnames/middleware — the repo deliberately runs without one).
  const languages: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${SITE_URL}/${loc}/audit`;
  }
  languages['x-default'] = `${SITE_URL}/en/audit`;
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: {
      canonical: `${SITE_URL}/${locale}/audit`,
      languages
    },
    openGraph: {
      title: `${t('metaTitle')} · OneShopLab`,
      description: t('metaDescription'),
      url: `${SITE_URL}/${locale}/audit`,
      type: 'website'
    }
  };
}

async function startFreeAuditAction(formData: FormData) {
  'use server';
  // Locale travels in a hidden field so the redirect keeps the visitor on
  // their language (localePrefix is 'always' — an unprefixed redirect would
  // bounce an /fr visitor to the default locale).
  const locale = String(formData.get('locale') ?? 'en');
  const safeLocale = (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : 'en';
  const norm = normalizeUrl(String(formData.get('url') ?? ''));
  if (!norm) {
    redirect(`/${safeLocale}/audit?error=invalid_url`);
  }
  // This is a public, unauthenticated scrape trigger — gate it behind
  // the captcha when configured. verifyRecaptcha returns ok:true when
  // no secret is set (dev-safe), so this is inert until keys are added.
  const captchaToken =
    String(formData.get('g-recaptcha-response') ?? '') ||
    String(formData.get('recaptcha_token') ?? '');
  const captcha = await verifyRecaptcha(captchaToken);
  if (!captcha.ok) {
    redirect(`/${safeLocale}/audit?error=captcha`);
  }
  const { token } = await launchAnonymousAudit(norm);
  redirect(`/${safeLocale}/audit/${token}`);
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function FreeAuditPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { error } = await searchParams;
  const t = await getTranslations('FreeAudit');
  const errorMessage =
    error === 'invalid_url' ? t('invalidUrl') : error === 'captcha' ? t('captchaError') : null;
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const recaptchaOn = isRecaptchaEnabled() && Boolean(recaptchaSiteKey);

  return (
    <main className="flex-1 relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="hero-glow" aria-hidden />
        <div className="hero-grid" aria-hidden />
        <div className="hero-spotlight" aria-hidden />
      </div>

      <section className="relative z-10 max-w-3xl w-full mx-auto px-6 py-12 md:py-16 min-h-[calc(100svh-5rem)] flex flex-col items-center justify-center text-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <span className="eyebrow">{t('eyebrow')}</span>
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

        <h1 className="text-4xl sm:text-5xl md:text-[3.25rem] font-bold tracking-tight max-w-2xl leading-[1.1]">
          {t('headline')}
        </h1>
        <p className="text-base md:text-lg text-[var(--muted)] max-w-xl leading-relaxed">
          {t('lead')}
        </p>

        <form
          action={startFreeAuditAction}
          className="w-full max-w-xl flex flex-col items-center gap-2"
        >
          <input type="hidden" name="locale" value={locale} />
          <div
            className={`relative w-full flex items-center rounded-full bg-[var(--surface)] border ${
              errorMessage ? 'border-[var(--danger)]' : 'border-[var(--border)]'
            } shadow-[0_2px_24px_-12px_oklch(0.20_0.02_250/0.18)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/15 transition-all`}
          >
            <label htmlFor="free-audit-url" className="sr-only">
              {t('urlLabel')}
            </label>
            {/* type="text" (not "url") on purpose: the browser's native
                url validation rejects a bare domain like "votreboutique.com"
                — it demands a scheme — which silently blocks mobile users
                who type their store without "https://". normalizeUrl()
                server-side already prepends the scheme + validates, so we
                accept the friendly bare form here. inputMode=url gives the
                URL-optimized mobile keyboard; autoCapitalize/spellCheck off
                avoid mangling the domain. */}
            <input
              id="free-audit-url"
              name="url"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              placeholder={t('urlPlaceholder')}
              aria-invalid={Boolean(errorMessage)}
              className="flex-1 min-w-0 px-5 sm:px-6 py-4 bg-transparent text-base outline-none rounded-full placeholder:text-[var(--field-placeholder)]"
            />
            <button
              type="submit"
              className="m-1.5 px-4 sm:px-5 py-2.5 rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Sparkles className="size-4" />
              <span className="hidden sm:inline">{t('submit')}</span>
              <ArrowRight className="size-4 sm:hidden" />
            </button>
          </div>
          {recaptchaOn ? <RecaptchaWrapper siteKey={recaptchaSiteKey!} /> : null}
          <p className={`text-xs ${errorMessage ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}>
            {errorMessage ?? t('trust')}
          </p>
          {recaptchaOn ? <RecaptchaLegalNotice /> : null}
        </form>

        {/* Subtle secondary path for the already-convinced minority —
            kept low-emphasis (small text link) so it never competes
            with the free-audit hero, which is the page's primary hook
            for cold ad traffic. */}
        <Link
          href="/signup"
          className="mt-4 inline-block text-sm text-[var(--muted)] hover:text-[var(--accent)] underline underline-offset-2 transition-colors"
        >
          {t('alreadyConvinced')}
        </Link>
      </section>
    </main>
  );
}
