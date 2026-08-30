'use server';

import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createApiKey,
  listProjectKeys,
  revokeApiKey,
  rotateApiKey,
  type OwnedResult,
  type CreatedApiKey
} from '@/entities/api-key';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { INTEGRATION_INTEREST_PLATFORMS, products, projects } from '@/shared/db/schema';
import { isUsableKey, toSiteKeySummary } from '../lib/key-state';
import { INTEGRATION_PLATFORMS, type ConnectionStatus, type KeyActionResult } from '../model/types';

const idSchema = z.string().uuid();
const MAX_KEY_NAME = 120;

function fromCreated(res: OwnedResult<CreatedApiKey>): KeyActionResult {
  if (!res.ok) return { ok: false, error: res.reason };
  return { ok: true, key: toSiteKeySummary(res.value.key), plaintext: res.value.plaintext };
}

/** Wizard step 3: one key per click; the plaintext is returned once and never stored. */
export async function createSiteKeyAction(formData: FormData): Promise<KeyActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return { ok: false, error: 'bad_request' };
  const name = String(formData.get('name') ?? '')
    .trim()
    .slice(0, MAX_KEY_NAME);
  const res = await createApiKey({
    projectId: projectId.data,
    userId: session.user.id,
    name: name || 'Site key'
  });
  revalidatePath(`/dashboard/sites/${projectId.data}`);
  return fromCreated(res);
}

export async function rotateSiteKeyAction(formData: FormData): Promise<KeyActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const keyId = idSchema.safeParse(formData.get('keyId'));
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!keyId.success || !projectId.success) return { ok: false, error: 'bad_request' };
  const res = await rotateApiKey({ keyId: keyId.data, userId: session.user.id });
  revalidatePath(`/dashboard/sites/${projectId.data}`);
  return fromCreated(res);
}

export async function revokeSiteKeyAction(
  formData: FormData
): Promise<{ ok: boolean; error?: 'unauthorized' | 'bad_request' | 'not_found' }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const keyId = idSchema.safeParse(formData.get('keyId'));
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!keyId.success || !projectId.success) return { ok: false, error: 'bad_request' };
  const res = await revokeApiKey({
    keyId: keyId.data,
    userId: session.user.id,
    reason: 'merchant'
  });
  revalidatePath(`/dashboard/sites/${projectId.data}`);
  return res.ok ? { ok: true } : { ok: false, error: 'not_found' };
}

/**
 * Wizard step 1. Only a project with no detected platform is updated: the
 * audit's detection stays authoritative for scraped stores, and a manual
 * catalog keeps its `manual` source so the dashboard keeps its add-product
 * flow.
 */
export async function setPlatformAction(formData: FormData): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  const platform = z.enum(INTEGRATION_PLATFORMS).safeParse(formData.get('platform'));
  if (!projectId.success || !platform.success) return { ok: false };
  await db
    .update(projects)
    .set({ source: platform.data })
    .where(
      and(
        eq(projects.id, projectId.data),
        eq(projects.userId, session.user.id),
        eq(projects.source, 'unknown')
      )
    );
  return { ok: true };
}

/** "Notify me" toggle of a connector that has not shipped yet. */
export async function setIntegrationInterestAction(
  formData: FormData
): Promise<{ ok: boolean; value?: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const projectId = idSchema.safeParse(formData.get('projectId'));
  const platform = z.enum(INTEGRATION_INTEREST_PLATFORMS).safeParse(formData.get('platform'));
  const value = formData.get('value') === '1';
  if (!projectId.success || !platform.success) return { ok: false };
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId.data), eq(projects.userId, session.user.id)),
    columns: { integrationInterest: true }
  });
  if (!project) return { ok: false };
  await db
    .update(projects)
    .set({
      integrationInterest: { ...(project.integrationInterest ?? {}), [platform.data]: value }
    })
    .where(eq(projects.id, projectId.data));
  return { ok: true, value };
}

/** Polled by the connection card (10 s): the plugin's last call + catalog size. */
export async function getConnectionStatusAction(formData: FormData): Promise<ConnectionStatus> {
  const empty: ConnectionStatus = { hasActiveKey: false, lastUsedAtIso: null, productCount: 0 };
  const session = await auth();
  if (!session?.user?.id) return empty;
  const projectId = idSchema.safeParse(formData.get('projectId'));
  if (!projectId.success) return empty;
  const [keys, countRow] = await Promise.all([
    listProjectKeys({ projectId: projectId.data, userId: session.user.id }),
    db
      .select({ value: count() })
      .from(products)
      .innerJoin(projects, eq(projects.id, products.projectId))
      .where(
        and(
          eq(products.projectId, projectId.data),
          eq(projects.userId, session.user.id),
          eq(products.status, 'active')
        )
      )
  ]);
  const usable = keys.filter((k) => isUsableKey(k));
  const lastUsed = keys
    .map((k) => k.lastUsedAt?.getTime() ?? 0)
    .reduce((max, ts) => Math.max(max, ts), 0);
  return {
    hasActiveKey: usable.length > 0,
    lastUsedAtIso: lastUsed > 0 ? new Date(lastUsed).toISOString() : null,
    productCount: countRow[0]?.value ?? 0
  };
}
