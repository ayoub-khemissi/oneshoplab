'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { auth } from '@/entities/user';
import { isAdminEmail } from '@/entities/user';
import { db } from '@/lib/db';
import { projects, shareLinks } from '@/lib/db/schema';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

/**
 * Bust every locale's home page cache when a showcased link changes.
 * The Showcase strip is rendered server-side as part of the locale
 * homepage, so simply revalidating '/' isn't enough — each /[locale]
 * variant has its own cached render.
 */
function revalidateAllHomePages(): void {
  for (const loc of SUPPORTED_LOCALES) {
    revalidatePath(`/${loc}`);
  }
  revalidatePath('/');
}

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
  const showOnHome = formData.get('showOnHome') === '1';

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
    label,
    showOnHome
  });

  revalidatePath(`/dashboard/sites/${siteId}`);
  if (showOnHome) revalidateAllHomePages();
  return { ok: true, jobId: id };
}

/**
 * Flip the home-page-showcase flag on an existing share link. Used
 * by the dashboard list's per-row toggle so the admin can curate
 * the home strip without recreating links.
 */
export async function setShareLinkShowOnHomeAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return { ok: false, error: 'unauthorized' };
  }
  const linkId = String(formData.get('linkId') ?? '');
  const siteId = String(formData.get('siteId') ?? '');
  const next = formData.get('showOnHome') === '1';
  if (!linkId) return { ok: false, error: 'bad_request' };

  await db
    .update(shareLinks)
    .set({ showOnHome: next })
    .where(
      and(
        eq(shareLinks.id, linkId),
        eq(shareLinks.userId, session.user.id),
        isNull(shareLinks.revokedAt)
      )
    );

  if (siteId) revalidatePath(`/dashboard/sites/${siteId}`);
  revalidateAllHomePages();
  return { ok: true };
}

/**
 * Set / clear the admin-curated home showcase order on a share link.
 * Lower numbers surface first within the visitor's language tier; null
 * means "unranked" and the link sorts by createdAt DESC at the end of
 * its tier. Pass an empty string (or non-numeric input) from the form
 * to clear the order back to NULL.
 */
export async function setShareLinkHomeOrderAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return { ok: false, error: 'unauthorized' };
  }
  const linkId = String(formData.get('linkId') ?? '');
  const siteId = String(formData.get('siteId') ?? '');
  const orderRaw = String(formData.get('homeOrder') ?? '').trim();
  if (!linkId) return { ok: false, error: 'bad_request' };

  let nextOrder: number | null = null;
  if (orderRaw !== '') {
    const parsed = Number.parseInt(orderRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 9999) {
      return { ok: false, error: 'invalid_order' };
    }
    nextOrder = parsed;
  }

  await db
    .update(shareLinks)
    .set({ homeOrder: nextOrder })
    .where(
      and(
        eq(shareLinks.id, linkId),
        eq(shareLinks.userId, session.user.id),
        isNull(shareLinks.revokedAt)
      )
    );

  if (siteId) revalidatePath(`/dashboard/sites/${siteId}`);
  revalidateAllHomePages();
  return { ok: true };
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
  // A revoked link disappears from the home showcase even if it was
  // flagged showOnHome, so always invalidate the homepages.
  revalidateAllHomePages();
  return { ok: true };
}
