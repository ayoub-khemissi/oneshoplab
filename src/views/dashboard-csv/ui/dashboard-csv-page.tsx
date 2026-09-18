import { and, eq } from 'drizzle-orm';
import { ArrowLeft, ArrowRight, FileSpreadsheet, Upload } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/entities/user';
import { Link } from '@/i18n/navigation';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';
import { ImportUnavailableToast } from './import-unavailable-toast';

/**
 * The CSV crossroads: two equal panels, import and export. The export exists
 * for every store; the import only for a "my own store" one, since a
 * connected catalogue belongs to the store upstream and importing into it
 * would fight the sync. That panel stays on the page, inert, with the reason
 * — a merchant who wonders where the import went should read why, not hunt.
 * A connected store that typed the import URL is sent back here with a
 * toast saying the same thing (ImportUnavailableToast).
 */
export async function DashboardCsvPage({ siteId }: { siteId: string }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, session.user.id)),
    columns: { id: true, name: true, domain: true, source: true }
  });
  if (!project) notFound();

  const t = await getTranslations('CsvHub');
  const canImport = project.source === 'manual';
  const base = `/dashboard/sites/${project.id}`;

  return (
    <main className="w-full max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6 min-w-0">
      <ImportUnavailableToast />
      <header className="flex flex-col gap-3">
        <Link
          href={`${base}?tab=products`}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors w-fit"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t('back')}
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg md:text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-[var(--muted)]">
            {t('subtitle', { domain: project.domain ?? project.name ?? '' })}
          </p>
        </div>
      </header>

      {/* Two halves, always the same height: the grid stretches its row, so
          the shorter card follows the taller one. */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
        <HubCard
          href={canImport ? `${base}/import` : null}
          icon={<Upload className="size-6" aria-hidden />}
          eyebrow={t('importEyebrow')}
          title={t('importTitle')}
          body={canImport ? t('importBody') : t('importUnavailable')}
          cta={t('importCta')}
          testId="csv-hub-import"
        />
        <HubCard
          href={`${base}/export`}
          icon={<FileSpreadsheet className="size-6" aria-hidden />}
          eyebrow={t('exportEyebrow')}
          title={t('exportTitle')}
          body={t('exportBody')}
          cta={t('exportCta')}
          testId="csv-hub-export"
        />
      </section>
    </main>
  );
}

function HubCard({
  href,
  icon,
  eyebrow,
  title,
  body,
  cta,
  testId
}: {
  href: string | null;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  testId: string;
}) {
  const shell =
    'group flex flex-col gap-4 rounded-2xl border p-6 md:p-8 min-h-[16rem] transition-colors';
  const inner = (
    <>
      <span className="inline-flex items-center justify-center size-12 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
        {icon}
      </span>
      <div className="flex flex-col gap-1.5 flex-1">
        <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium">
          {eyebrow}
        </span>
        <h2 className="text-lg md:text-xl font-semibold">{title}</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed">{body}</p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        {cta}
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </>
  );
  if (!href) {
    return (
      <div
        data-testid={testId}
        aria-disabled="true"
        className={`${shell} border-dashed border-[var(--border)] text-[var(--muted)] opacity-80`}
      >
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`${shell} border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]`}
    >
      {inner}
    </Link>
  );
}
