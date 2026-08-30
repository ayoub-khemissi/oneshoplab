'use server';

import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { recomputeManualAudit } from '@/entities/audit';
import { auth } from '@/entities/user';
import { db } from '@/lib/db';
import { products, projects } from '@/lib/db/schema';

/**
 * Manual archive / restore of a single product from the products tab.
 * Works for every project type (manual or scraped). The archive is
 * sticky — `products.manuallyArchived` tells syncProjectProducts not to
 * un-archive the row on the next re-scrape (see sync-products.ts).
 *
 * No credit cost, fully reversible. The page derives the active list
 * from `audits.summary.allProducts` (the cached scrape) and overlays
 * the products-table status, so flipping `status` here is enough to
 * move the row between the active list and the "archived" toggle — no
 * re-scrape required.
 */

const Schema = z.object({
  projectId: z.string().uuid(),
  productId: z.string().uuid(),
  archived: z.enum(['0', '1'])
});

export async function setProductArchivedAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const parsed = Schema.safeParse({
    projectId: String(formData.get('projectId') ?? ''),
    productId: String(formData.get('productId') ?? ''),
    archived: String(formData.get('archived') ?? '')
  });
  if (!parsed.success) redirect('/dashboard');
  const { projectId, productId, archived } = parsed.data;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.user.id)),
    columns: { id: true, source: true }
  });
  if (!project) redirect('/dashboard');

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, projectId)),
    columns: { id: true }
  });
  if (!product) redirect(`/dashboard/sites/${projectId}?tab=products`);

  const toArchived = archived === '1';
  await db
    .update(products)
    .set(
      toArchived
        ? { status: 'archived', archivedAt: new Date(), manuallyArchived: true }
        : { status: 'active', archivedAt: null, manuallyArchived: false }
    )
    .where(eq(products.id, productId));

  // Manual projects cache their report in audits.summary via this
  // recompute; scraped projects keep the cached scrape and rely on the
  // page-level status overlay, so no recompute is needed there.
  if (project.source === 'manual') {
    void recomputeManualAudit(projectId).catch((e) =>
      console.error('[product archive] recompute failed', e)
    );
  }

  // No redirect: returning void from a `<form action>` keeps the user
  // on the same URL (search / sort / page preserved). revalidatePath
  // refreshes the server component so the row moves lists.
  revalidatePath(`/dashboard/sites/${projectId}`);
}
