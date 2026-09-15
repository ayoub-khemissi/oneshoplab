import { and, asc, eq, ne } from 'drizzle-orm';
import { DEMO_PRODUCT_ID } from '@/shared/lib';
import { db } from '@/shared/db';
import { products, projects } from '@/shared/db/schema';

/**
 * Which product the guided tour should open for a site.
 *
 * A real one whenever the merchant has a catalogue — the point of the step is
 * to show THEIR product — and the built-in sample otherwise. Archived rows
 * are skipped: they render behind a banner and disabled buttons, which is a
 * poor first thing to show.
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

  const [first] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.projectId, project.id), ne(products.status, 'archived')))
    // Stable pick: replaying the tour lands on the same product every time.
    .orderBy(asc(products.createdAt), asc(products.id))
    .limit(1);

  return first?.id ?? DEMO_PRODUCT_ID;
}
