'use server';

import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  getConnectionForUser,
  toWixConnectionView,
  type WixConnectionView
} from '@/entities/shop-connection';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
import { isWixAppConfigured } from '../lib/config';
import { disconnectWixStore, requestWixPull } from './oauth';

const idSchema = z.string().uuid();

export type WixActionError = 'unauthorized' | 'bad_request' | 'not_found' | 'not_configured';
export type WixActionResult = { ok: true } | { ok: false; error: WixActionError };

async function activeProductCount(projectId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(products)
    .where(and(eq(products.projectId, projectId), eq(products.status, 'active')));
  return row?.value ?? 0;
}

/** Polled by the Wix card. Null when the project has no Wix connection row. */
export async function getWixConnectionAction(
  formData: FormData
): Promise<WixConnectionView | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return null;
  const connection = await getConnectionForUser(projectId.data, session.user.id);
  if (!connection || connection.platform !== 'wix') return null;
  return toWixConnectionView(connection, await activeProductCount(projectId.data));
}

/** The install itself is a redirect: `GET /api/integrations/wix/install?projectId&locale`. */
export async function getWixInstallUrlAction(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: WixActionError }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return { ok: false, error: 'bad_request' };
  if (!isWixAppConfigured()) return { ok: false, error: 'not_configured' };
  const locale = String(formData.get('locale') ?? 'en');
  const qs = new URLSearchParams({ projectId: projectId.data, locale });
  return { ok: true, url: `/api/integrations/wix/install?${qs.toString()}` };
}

export async function disconnectWixAction(formData: FormData): Promise<WixActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return { ok: false, error: 'bad_request' };
  const ok = await disconnectWixStore(projectId.data, session.user.id);
  revalidatePath(`/dashboard/sites/${projectId.data}`);
  return ok ? { ok: true } : { ok: false, error: 'not_found' };
}

export async function requestWixPullAction(formData: FormData): Promise<WixActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return { ok: false, error: 'bad_request' };
  const ok = await requestWixPull(projectId.data, session.user.id);
  return ok ? { ok: true } : { ok: false, error: 'not_found' };
}
