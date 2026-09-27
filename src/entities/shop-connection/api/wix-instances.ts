import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/shared/db';
import { wixInstances } from '@/shared/db/schema';

export type WixInstanceRow = typeof wixInstances.$inferSelect;

export interface WixInstanceFacts {
  siteName: string | null;
  siteHost: string | null;
  ownerEmail: string | null;
  siteLocale: string | null;
}

export async function getWixInstance(instanceId: string): Promise<WixInstanceRow | null> {
  const [row] = await db.select().from(wixInstances).where(eq(wixInstances.instanceId, instanceId));
  return row ?? null;
}

/**
 * Records an install seen from the Wix dashboard or from our own install
 * flow. A reinstall clears `uninstalledAt` and keeps the owner and project:
 * the dashboard page reconnects them instead of asking the merchant again.
 */
export async function recordWixInstall(
  instanceId: string,
  facts: WixInstanceFacts
): Promise<WixInstanceRow> {
  const existing = await getWixInstance(instanceId);
  const values = {
    siteName: facts.siteName,
    siteHost: facts.siteHost,
    ownerEmail: facts.ownerEmail?.toLowerCase().trim() || null,
    siteLocale: facts.siteLocale,
    uninstalledAt: null
  };
  if (!existing) {
    await db.insert(wixInstances).values({ instanceId, ...values });
  } else {
    await db
      .update(wixInstances)
      .set({ ...values, ...(existing.uninstalledAt ? { installedAt: new Date() } : {}) })
      .where(eq(wixInstances.instanceId, instanceId));
  }
  return (await getWixInstance(instanceId))!;
}

export async function markWixInstanceLinked(
  instanceId: string,
  userId: string,
  projectId: string
): Promise<void> {
  await db
    .update(wixInstances)
    .set({ userId, projectId, linkedAt: new Date() })
    .where(eq(wixInstances.instanceId, instanceId));
}

export async function markWixInstanceUninstalled(
  instanceId: string
): Promise<WixInstanceRow | null> {
  await db
    .update(wixInstances)
    .set({ uninstalledAt: new Date() })
    .where(eq(wixInstances.instanceId, instanceId));
  return getWixInstance(instanceId);
}

export async function installedWixInstancesFor(userId: string): Promise<WixInstanceRow[]> {
  return db
    .select()
    .from(wixInstances)
    .where(and(eq(wixInstances.userId, userId), isNull(wixInstances.uninstalledAt)));
}
