import { and, eq } from 'drizzle-orm';
import { ArrowLeft, PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ManualProductForm } from '@/features/manual-catalog';
import { Link } from '@/i18n/navigation';
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
    title: t('addProductPageTitle'),
    robots: { index: false, follow: false }
  };
}

interface PageProps {
  params: Promise<{ siteId: string }>;
}

export default async function NewProductPage({ params }: PageProps) {
  const { siteId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, session.user.id)),
    columns: { id: true, name: true, source: true }
  });
  if (!project) redirect('/dashboard');
  // Manual-only entry — for scraped projects, products come from the
  // adapter and there's no manual create path.
  if (project.source !== 'manual') redirect(`/dashboard/sites/${siteId}`);

  const t = await getTranslations('Dashboard');

  return (
    <main className="flex-1 p-4 md:p-10 max-w-3xl w-full mx-auto flex flex-col gap-6 md:gap-8">
      <Link
        href={`/dashboard/sites/${siteId}`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors w-fit"
      >
        <ArrowLeft className="size-3.5" />
        {project.name}
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium inline-flex items-center gap-2">
          <PenLine className="size-3.5" aria-hidden />
          {t('addSiteScratchEyebrow')}
        </span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          {t('addProductPageTitle')}
        </h1>
        <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed">
          {t('addProductPageSubtitle')}
        </p>
      </header>

      <ManualProductForm initial={{ projectId: siteId }} />
    </main>
  );
}
