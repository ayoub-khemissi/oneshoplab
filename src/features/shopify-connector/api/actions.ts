'use server';

import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  getConnectionForUser,
  toShopifyConnectionView,
  type ShopifyConnectionView
} from '@/entities/shop-connection';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
import { connectShopifyStore, disconnectShopifyStore, requestShopifyPull } from './validate';
import type { ConnectFailure } from './validate';

const idSchema = z.string().uuid();
const MAX_SECRET = 512;

export type ShopifyActionError = ConnectFailure | 'unauthorized' | 'bad_request';

export type ConnectShopifyActionResult =
  | { ok: true; connection: ShopifyConnectionView; webhooks: 'registered' | 'skipped' | 'failed' }
  | { ok: false; error: ShopifyActionError };

async function activeProductCount(projectId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(products)
    .where(and(eq(products.projectId, projectId), eq(products.status, 'active')));
  return row?.value ?? 0;
}

/** Wizard step 3 (Shopify): validate + seal the pasted token. The token never comes back. */
export async function connectShopifyAction(
  formData: FormData
): Promise<ConnectShopifyActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return { ok: false, error: 'bad_request' };
  const shopDomain = String(formData.get('shopDomain') ?? '').slice(0, 255);
  const accessToken = String(formData.get('accessToken') ?? '').slice(0, MAX_SECRET);
  const apiSecret = String(formData.get('apiSecret') ?? '')
    .trim()
    .slice(0, MAX_SECRET);
  if (!accessToken.trim()) return { ok: false, error: 'invalid_token' };
  const res = await connectShopifyStore({
    projectId: projectId.data,
    userId: session.user.id,
    shopDomain,
    accessToken,
    apiSecret: apiSecret || null
  });
  if (!res.ok) return { ok: false, error: res.reason };
  revalidatePath(`/dashboard/sites/${projectId.data}`);
  // Re-read: `res.connection` predates the queued pull (pullRequestedAt), which the card shows.
  const fresh = (await getConnectionForUser(projectId.data, session.user.id)) ?? res.connection;
  return {
    ok: true,
    connection: toShopifyConnectionView(fresh, await activeProductCount(projectId.data)),
    webhooks: res.webhooks
  };
}

export async function disconnectShopifyAction(
  formData: FormData
): Promise<{ ok: boolean; error?: 'unauthorized' | 'bad_request' | 'not_found' }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return { ok: false, error: 'bad_request' };
  const ok = await disconnectShopifyStore(projectId.data, session.user.id);
  revalidatePath(`/dashboard/sites/${projectId.data}`);
  return ok ? { ok: true } : { ok: false, error: 'not_found' };
}

/** "Synchroniser maintenant": only the owner of a connected project can queue a pull. */
export async function requestShopifyPullAction(
  formData: FormData
): Promise<{ ok: boolean; error?: 'unauthorized' | 'bad_request' | 'not_found' }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return { ok: false, error: 'bad_request' };
  const connection = await getConnectionForUser(projectId.data, session.user.id);
  if (!connection || connection.status !== 'connected') return { ok: false, error: 'not_found' };
  await requestShopifyPull(projectId.data);
  return { ok: true };
}

/** Polled by the Shopify card (10 s). Null when the project has no connection row. */
export async function getShopifyConnectionAction(
  formData: FormData
): Promise<ShopifyConnectionView | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return null;
  const connection = await getConnectionForUser(projectId.data, session.user.id);
  if (!connection) return null;
  return toShopifyConnectionView(connection, await activeProductCount(projectId.data));
}
