import { and, eq } from 'drizzle-orm';
import { ArrowLeft, Upload } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/entities/user';
import { Link } from '@/i18n/navigation';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';
import { ImportWizard } from './import-wizard';

export async function DashboardImportPage({ siteId }: { siteId: string }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, session.user.id)),
    columns: { id: true, name: true, domain: true, source: true }
  });
  if (!project) notFound();
  // A connected store has no import: its catalogue lives upstream. Back to
  // the crossroads, where the inert import panel and a toast say why — the
  // export page alone would leave the merchant guessing what happened.
  if (project.source !== 'manual')
    redirect(`/dashboard/sites/${project.id}/csv?importUnavailable=1`);

  const t = await getTranslations('ImportCatalog');
  return (
    <main className="w-full max-w-5xl mx-auto px-4 py-6 flex flex-col gap-5 min-w-0">
      <header className="flex flex-col gap-3">
        <Link
          href={`/dashboard/sites/${project.id}/csv`}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors w-fit"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t('back')}
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg md:text-xl font-semibold inline-flex items-center gap-2">
            <Upload className="size-5 text-[var(--accent)]" aria-hidden />
            {t('title')}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {t('subtitle', { name: project.name ?? project.domain ?? '' })}
          </p>
        </div>
      </header>
      <ImportWizard siteId={project.id} exportHref={`/dashboard/sites/${project.id}/export`} />
    </main>
  );
}
