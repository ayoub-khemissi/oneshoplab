import { InputGroup, Label, TextField } from '@heroui/react';
import { eq } from 'drizzle-orm';
import { ArrowLeft, ArrowRight, Globe, PenLine, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { siteLimitForPlan } from '@/entities/ai-model';
import { launchAuditForUser, MIN_AUDIT_CREDITS, normalizeUrl } from '@/features/run-audit';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

async function addSiteAction(formData: FormData): Promise<void> {
  'use server';
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const raw = String(formData.get('url') ?? '');
  const norm = normalizeUrl(raw);
  if (!norm) {
    redirect('/dashboard/sites/new?error=invalid_url');
  }

  if ((session.user.creditsBalance ?? 0) < MIN_AUDIT_CREDITS) {
    redirect('/pricing?error=insufficient_credits');
  }

  // Quota check — re-auditing an existing domain reuses the project, so it
  // doesn't count toward the limit. Only block when the user is actually
  // creating a *new* project.
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

export default async function AddSitePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const params = await searchParams;
  const t = await getTranslations('Dashboard');

  const errorMessage =
    params.error === 'invalid_url'
      ? t('addSiteErrorInvalidUrl')
      : params.error === 'insufficient_credits'
        ? t('addSiteErrorInsufficientCredits')
        : params.error === 'site_limit_reached'
          ? t('addSiteErrorQuotaReached')
          : null;

  return (
    <main className="flex-1 p-4 md:p-10 max-w-2xl w-full mx-auto flex flex-col gap-6 md:gap-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors w-fit"
      >
        <ArrowLeft className="size-3.5" />
        {t('backToDashboard')}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{t('addSitePageTitle')}</h1>
        <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed">
          {t('addSitePageSubtitle', { credits: MIN_AUDIT_CREDITS })}
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

      <form action={addSiteAction} className="flex flex-col gap-4">
        <TextField fullWidth isRequired name="url" type="url" autoFocus>
          <Label>{t('addSiteUrlLabel')}</Label>
          <InputGroup>
            <InputGroup.Prefix>
              <Globe className="size-4" />
            </InputGroup.Prefix>
            <InputGroup.Input placeholder={t('addSiteUrlPlaceholder')} />
          </InputGroup>
        </TextField>
        <button
          type="submit"
          className="self-start px-5 py-2.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity font-medium inline-flex items-center gap-2"
        >
          <Sparkles className="size-4" />
          {t('addSiteSubmit')}
        </button>
      </form>

      {/* "or" divider — two horizontal rules flanking the word so the
          two entry points read as equal-weight options, not URL-first
          with a fallback link. */}
      <div className="flex items-center gap-3" aria-hidden>
        <span className="flex-1 h-px bg-[var(--border)]" />
        <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium">
          {t('addSiteOrDivider')}
        </span>
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>

      {/* Manual-entry CTA. Visually a parallel of the URL form above —
          same vertical block size, same heading style, button-level
          prominence — so the user sees "two ways to start", not "the
          fallback escape hatch". */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
          <PenLine className="size-4 text-[var(--accent)]" aria-hidden />
          {t('addSiteScratchTitle')}
        </h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed">{t('addSiteScratchSubtitle')}</p>
        <Link
          href="/dashboard/sites/new/scratch"
          className="self-start px-5 py-2.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity font-medium inline-flex items-center gap-2"
        >
          <PenLine className="size-4" />
          {t('addSiteScratchSubmit')}
          <ArrowRight className="size-3.5 opacity-80" aria-hidden />
        </Link>
      </section>
    </main>
  );
}
