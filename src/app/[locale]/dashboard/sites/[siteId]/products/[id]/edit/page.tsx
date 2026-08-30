import { and, eq } from 'drizzle-orm';
import { ArrowLeft, PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect, notFound } from 'next/navigation';
import { ManualProductForm } from '@/features/manual-catalog';
import { Link } from '@/i18n/navigation';
import { auth } from '@/entities/user';
import { db } from '@/lib/db';
import { products, projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Dashboard' });
  return {
    title: t('editProductPageTitle'),
    robots: { index: false, follow: false }
  };
}

interface PageProps {
  params: Promise<{ siteId: string; id: string }>;
}

export default async function EditManualProductPage({ params }: PageProps) {
  const { siteId, id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, session.user.id)),
    columns: { id: true, name: true, source: true }
  });
  if (!project) redirect('/dashboard');
  // Only manual products are user-editable today. Scraped products
  // are sourced from the adapter and the user shouldn't be able to
  // bend that data — they'd just be desynced on the next re-scrape.
  if (project.source !== 'manual') {
    redirect(`/dashboard/sites/${siteId}/products/${id}`);
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, id), eq(products.projectId, siteId))
  });
  if (!product) notFound();

  const t = await getTranslations('Dashboard');

  return (
    <main className="flex-1 p-4 md:p-10 max-w-3xl w-full mx-auto flex flex-col gap-6 md:gap-8">
      <Link
        href={`/dashboard/sites/${siteId}/products/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors w-fit"
      >
        <ArrowLeft className="size-3.5" />
        {product.title}
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium inline-flex items-center gap-2">
          <PenLine className="size-3.5" aria-hidden />
          {t('siteHeaderManualBadge')}
        </span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          {t('editProductPageTitle')}
        </h1>
      </header>

      <ManualProductForm
        initial={{
          projectId: siteId,
          productId: id,
          title: product.title,
          descriptionHtml: product.descriptionHtml ?? '',
          tags: product.tags ?? [],
          vendor: product.vendor,
          productType: product.productType,
          priceMin: product.priceMin != null ? Number(product.priceMin) : null,
          priceMax: product.priceMax != null ? Number(product.priceMax) : null,
          currency: product.currency,
          images: (product.images ?? []).map((i) => ({
            src: i.src,
            alt: i.alt ?? null,
            width: i.width ?? null,
            height: i.height ?? null
          }))
        }}
      />
    </main>
  );
}
