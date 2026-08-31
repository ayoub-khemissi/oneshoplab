import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db } from '@/shared/db';
import { apiKeys, projects, shopConnections } from '@/shared/db/schema';

/**
 * How long a site key that stopped calling still counts as "connected". Same
 * window the audit uses to decide it can score the synced catalog rather than
 * re-scrape the storefront (`decideAuditSource`) — a WooCommerce store has no
 * `shop_connections` row at all, its plugin's key IS the connection.
 */
export const SITE_KEY_ACTIVE_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/** One project: is a store actually plugged in right now? */
export async function isProjectConnected(projectId: string, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - SITE_KEY_ACTIVE_FOR_MS);
  const [row] = await db
    .select({ id: shopConnections.id })
    .from(shopConnections)
    .where(and(eq(shopConnections.projectId, projectId), eq(shopConnections.status, 'connected')))
    .limit(1);
  if (row) return true;
  const [key] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.projectId, projectId),
        isNull(apiKeys.revokedAt),
        gt(apiKeys.lastUsedAt, cutoff)
      )
    )
    .limit(1);
  return Boolean(key);
}

/**
 * The same answer for every store of an account, in two reads — the dashboard
 * home marks the ones still waiting to be connected.
 */
export async function listConnectedProjectIds(
  userId: string,
  now: Date = new Date()
): Promise<Set<string>> {
  const owned = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId));
  const ids = owned.map((p) => p.id);
  if (ids.length === 0) return new Set();
  const cutoff = new Date(now.getTime() - SITE_KEY_ACTIVE_FOR_MS);
  const [connections, keys] = await Promise.all([
    db
      .select({ projectId: shopConnections.projectId })
      .from(shopConnections)
      .where(and(inArray(shopConnections.projectId, ids), eq(shopConnections.status, 'connected'))),
    db
      .select({ projectId: apiKeys.projectId })
      .from(apiKeys)
      .where(
        and(
          inArray(apiKeys.projectId, ids),
          isNull(apiKeys.revokedAt),
          gt(apiKeys.lastUsedAt, cutoff)
        )
      )
  ]);
  return new Set([...connections, ...keys].map((r) => r.projectId));
}
