import { InputGroup, Label, TextField } from '@heroui/react';
import { and, eq } from 'drizzle-orm';
import { ArrowLeft, Globe, PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { LocalePicker } from '@/components/locale-picker';
import { Link } from '@/i18n/navigation';
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/routing';
import { siteLimitForPlan } from '@/lib/ai/models';
import { recomputeManualAudit } from '@/lib/audit/from-scratch';
import { normalizeUrl } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Dashboard' });
  return {
    title: t('addSiteScratchPageTitle'),
    robots: { index: false, follow: false }
  };
}

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

async function createScratchSiteAction(formData: FormData): Promise<void> {
  'use server';
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Accept all the casual flavours the user is likely to type:
  // `shop.com`, `www.shop.com`, `https://shop.com`, `https://www.shop.com`.
  // normalizeUrl prepends https:// when missing and parses through
  // the URL constructor, so anything that resolves to a hostname with
  // a dot is accepted.
  const rawUrl = String(formData.get('url') ?? '');
  const rawLanguage = String(formData.get('language') ?? '')
    .trim()
    .toLowerCase();
  const norm = normalizeUrl(rawUrl);
  if (!norm) {
    redirect('/dashboard/sites/new/scratch?error=invalid_url');
  }
  const languageOverride = (SUPPORTED_LOCALES as readonly string[]).includes(rawLanguage)
    ? rawLanguage
    : null;

  // Duplicate guard — (userId, domain) is the identity. If the user
  // already has a project for this domain (manual OR scraped), reuse
  // it instead of creating a second one. Mirrors the dedupe that
  // launchAuditForUser already does on the scraped path.
  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.userId, session.user.id), eq(projects.domain, norm.domain)),
    columns: { id: true }
  });
  if (existing) {
    redirect(`/dashboard/sites/${existing.id}`);
  }

  // Quota check — manual sites count toward the same per-plan ceiling
  // as scraped projects. No separate "manual sites" knob.
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session.user.id),
    columns: { id: true }
  });
  const limit = siteLimitForPlan(session.user.plan);
  if (userProjects.length >= limit) {
    redirect('/pricing?error=site_limit_reached');
  }

  const projectId = randomUUID();
  await db.insert(projects).values({
    id: projectId,
    userId: session.user.id,
    // Use the domain as the project name; the user can rename via
    // the per-site Settings tab later. We also persist domain + url
    // so the URL is the canonical handle even if the storefront
    // doesn't exist online yet.
    name: norm.domain,
    source: 'manual',
    domain: norm.domain,
    url: norm.url,
    languageOverride
  });

  // Seed an empty manual audit row so the per-site page renders
  // immediately. Recomputes will refresh it as products land.
  await recomputeManualAudit(projectId).catch((e) =>
    console.error('[scratch site] initial recompute failed', e)
  );

  redirect(`/dashboard/sites/${projectId}`);
}

export default async function NewScratchSitePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const params = await searchParams;
  const t = await getTranslations('Dashboard');
  const currentLocale = (await getLocale()) as Locale;

  const errorMessage =
    params.error === 'invalid_url'
      ? t('addSiteErrorInvalidUrl')
      : params.error === 'site_limit_reached'
        ? t('addSiteErrorQuotaReached')
        : null;

  return (
    <main className="flex-1 p-4 md:p-10 max-w-2xl w-full mx-auto flex flex-col gap-6 md:gap-8">
      <Link
        href="/dashboard/sites/new"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors w-fit"
      >
        <ArrowLeft className="size-3.5" />
        {t('addSiteBackToOptions')}
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium inline-flex items-center gap-2">
          <PenLine className="size-3.5" aria-hidden />
          {t('addSiteScratchEyebrow')}
        </span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          {t('addSiteScratchPageTitle')}
        </h1>
        <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed">
          {t('addSiteScratchPageSubtitle')}
        </p>
      </header>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md bg-[var(--danger)]/10 border border-[var(--danger)]/30 p-3 text-sm text-[var(--danger)]"
        >
          {errorMessage}
        </div>
      ) : null}

      <form action={createScratchSiteAction} className="flex flex-col gap-4">
        <TextField fullWidth isRequired name="url" autoFocus maxLength={1024}>
          <Label>{t('addSiteScratchUrlLabel')}</Label>
          <InputGroup>
            <InputGroup.Prefix>
              <Globe className="size-4" />
            </InputGroup.Prefix>
            <InputGroup.Input placeholder="www.shop.com" />
          </InputGroup>
        </TextField>
        <span className="text-xs text-[var(--muted)] -mt-2 leading-relaxed">
          {t('addSiteScratchUrlHint')}
        </span>

        <LocalePicker
          name="language"
          defaultLocale={currentLocale}
          label={t('addSiteScratchLanguageLabel')}
        />
        <span className="text-xs text-[var(--muted)] -mt-1">{t('addSiteScratchLanguageHint')}</span>

        <button
          type="submit"
          className="self-start px-5 py-2.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity font-medium inline-flex items-center gap-2"
        >
          <PenLine className="size-4" />
          {t('addSiteScratchSubmit')}
        </button>
      </form>
    </main>
  );
}
