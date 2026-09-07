import { and, eq, or } from 'drizzle-orm';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';

/**
 * The product row a generation key refers to, or null.
 *
 * Keys are `sourceId` by the rule in `lib/source-key.ts`, but rows filed by
 * handle exist — from the storefront-audit era, and from a bug where the
 * snapshot's key was used — and those must still attach to their product, or
 * the past-generations strip and the Activity tab lose the link.
 */
export async function findProductIdByKey(projectId: string, key: string): Promise<string | null> {
  if (!key) return null;
  const row = await db.query.products.findFirst({
    where: and(
      eq(products.projectId, projectId),
      or(eq(products.sourceId, key), eq(products.handle, key), eq(products.id, key))
    ),
    columns: { id: true, sourceId: true }
  });
  return row?.id ?? null;
}
