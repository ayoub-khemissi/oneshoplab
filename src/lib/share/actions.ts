'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { db } from '@/lib/db';
import { projects, shareLinks } from '@/lib/db/schema';

/**
 * Server actions for the sales-prospection share-link flow. Both
 * actions enforce two gates: signed-in user AND email present in the
 * ADMIN_EMAILS env list. A regular merchant calling these directly
 * (e.g. forging the form submission) gets an `unauthorized` error.
 */

export async function createShareLinkAction(
  formData: FormData
): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return { ok: false, error: 'unauthorized' };
  }

  const siteId = String(formData.get('siteId') ?? '');
  const productSourceIdsRaw = formData.getAll('productSourceIds').map(String);
  const label = String(formData.get('label') ?? '').slice(0, 120) || null;

  if (!siteId) return { ok: false, error: 'bad_request' };
  // We need exactly 2 products for the case-study layout. Allowing 1
  // would render lopsided; 3+ blows out the reading length.
  const productSourceIds = productSourceIdsRaw.filter(Boolean);
  if (productSourceIds.length !== 2) {
    return { ok: false, error: 'need_two_products' };
  }

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, session.user.id))
  });
  if (!project) return { ok: false, error: 'site_not_found' };

  const id = randomUUID();
  await db.insert(shareLinks).values({
    id,
    userId: session.user.id,
    projectId: project.id,
    productSourceIds,
    label
  });

  revalidatePath(`/dashboard/sites/${siteId}`);
  return { ok: true, jobId: id };
}

export async function revokeShareLinkAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return { ok: false, error: 'unauthorized' };
  }
  const linkId = String(formData.get('linkId') ?? '');
  const siteId = String(formData.get('siteId') ?? '');
  if (!linkId) return { ok: false, error: 'bad_request' };

  await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(shareLinks.id, linkId),
        eq(shareLinks.userId, session.user.id),
        isNull(shareLinks.revokedAt)
      )
    );

  if (siteId) revalidatePath(`/dashboard/sites/${siteId}`);
  return { ok: true };
}
