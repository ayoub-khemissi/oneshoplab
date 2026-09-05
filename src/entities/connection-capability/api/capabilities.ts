import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/shared/db';
import {
  connectionCapabilities,
  shopConnections,
  type ConnectionCapabilities
} from '@/shared/db/schema';
import { capabilitiesSchema, normalizeCapabilities } from '../lib/schema';
import {
  MINIMUM_CAPABILITIES,
  PLATFORM_CAPABILITIES,
  shopifyCapabilitiesFor
} from '../model/capabilities';

/** Persisted on `POST /products/sync` when the plugin sends `capabilities`. */
export async function saveReportedCapabilities(
  projectId: string,
  platform: string,
  reported: unknown
): Promise<ConnectionCapabilities | null> {
  const parsed = capabilitiesSchema.safeParse(reported);
  if (!parsed.success) return null;
  const capabilities = normalizeCapabilities(parsed.data);
  await db
    .insert(connectionCapabilities)
    .values({ projectId, platform, capabilities })
    .onDuplicateKeyUpdate({ set: { platform, capabilities, reportedAt: new Date() } });
  return capabilities;
}

/**
 * The single answer to "what can this project's store do?" (IMAGE-OPS.md §7).
 * A live OSL-driven connection wins over anything a plugin reported: the
 * connector's own code is what will execute the ops. No connection and nothing
 * reported → the safe minimum, i.e. replace-all only.
 */
export async function getProjectCapabilities(projectId: string): Promise<ConnectionCapabilities> {
  const [connection] = await db
    .select({ platform: shopConnections.platform, scopes: shopConnections.scopes })
    .from(shopConnections)
    .where(and(eq(shopConnections.projectId, projectId), ne(shopConnections.status, 'revoked')));
  if (connection) {
    // Shopify's alt editing depends on a scope the merchant may or may not have
    // granted, so the answer comes from their own connection, not from a table.
    return connection.platform === 'shopify'
      ? shopifyCapabilitiesFor(connection.scopes)
      : PLATFORM_CAPABILITIES[connection.platform];
  }

  const [reported] = await db
    .select({ capabilities: connectionCapabilities.capabilities })
    .from(connectionCapabilities)
    .where(eq(connectionCapabilities.projectId, projectId));
  return reported?.capabilities ?? MINIMUM_CAPABILITIES;
}
