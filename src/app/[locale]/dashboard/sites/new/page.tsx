import { InputGroup, Label, TextField } from '@heroui/react';
import { eq } from 'drizzle-orm';
import { ArrowLeft, Globe, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { siteLimitForPlan } from '@/lib/ai/models';
import { launchAuditForUser, MIN_AUDIT_CREDITS, normalizeUrl } from '@/lib/audit';
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
    <main className="flex-1 p-6 md:p-10 max-w-2xl w-full mx-auto flex flex-col gap-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors w-fit"
      >
        <ArrowLeft className="size-3.5" />
        {t('backToDashboard')}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          {t('addSitePageTitle')}
        </h1>
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
    </main>
  );
}
