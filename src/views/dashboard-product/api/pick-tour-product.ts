import { and, asc, eq, gt, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/shared/db';
import { apiKeys, jobs, products, projects, shopConnections } from '@/shared/db/schema';
import { DEMO_PRODUCT_ID } from '@/shared/lib';

/**
 * Which product the guided tour should open for a site.
 *
 * Their own product whenever that page will actually show what the tour is
 * about — the point of the step is to point at THEIR catalogue. Two cases
 * send it to the built-in sample instead:
 *
 *   - no catalogue yet;
 *   - no store connected. The product page deliberately hides the
 *     send-to-store controls and the photo editor until a store can receive
 *     changes, which are precisely the anchors of the last two product steps.
 *     Opening the real page there leaves those steps pointing at nothing —
 *     the defect this rule exists to prevent.
 *
 * Archived rows are skipped: they render behind a banner and disabled
 * buttons, a poor first thing to show.
 *
 * Returns null when the site does not belong to the caller, so the route can
 * answer the same way it would for a site that does not exist.
 */
export async function pickTourProductId(userId: string, siteId: string): Promise<string | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, userId)),
    columns: { id: true }
  });
  if (!project) return null;

  if (!(await canReceiveChanges(project.id))) return DEMO_PRODUCT_ID;

  // A product that has already been through a generation. Without one there
  // is nothing to send, so the send-to-store control does not render and the
  // tenth step lights up nothing — the whole point of this function. A
  // merchant on their first day has none, and lands on the sample; one
  // replaying the tour later sees their own work.
  const [first] = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(jobs, and(eq(jobs.productId, products.id), eq(jobs.status, 'completed')))
    .where(and(eq(products.projectId, project.id), ne(products.status, 'archived')))
    // Stable pick: replaying the tour lands on the same product every time.
    .orderBy(asc(products.createdAt), asc(products.id))
    .limit(1);

  return first?.id ?? DEMO_PRODUCT_ID;
}

/**
 * Same question the product page asks before showing the send-to-store
 * controls: a connected connector, or a site key the plugin can still use.
 *
 * Written as SQL rather than through the api-key and integrations barrels on
 * purpose — those pull next-auth, which breaks this module under vitest and
 * would drag authentication into a route that only needs a boolean. Keep the
 * two rules in step: features/apply-to-store `canReceive` is the same one.
 */
async function canReceiveChanges(projectId: string): Promise<boolean> {
  const connection = await db.query.shopConnections.findFirst({
    where: and(eq(shopConnections.projectId, projectId), eq(shopConnections.status, 'connected')),
    columns: { id: true }
  });
  if (connection) return true;

  const now = new Date();
  const [usable] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.projectId, projectId),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.graceUntil), gt(apiKeys.graceUntil, now)),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))
      )
    )
    .limit(1);
  return usable != null;
}
