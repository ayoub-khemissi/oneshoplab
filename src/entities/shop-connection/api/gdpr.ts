import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/shared/db';
import { gdprRequests, type GdprTopic } from '@/shared/db/schema';

export type GdprRequestRow = typeof gdprRequests.$inferSelect;

/** Audit trail of Shopify compliance webhooks (we hold no customer data — the row is the proof of receipt). */
export async function recordGdprRequest(
  shopDomain: string,
  topic: GdprTopic,
  payload: Record<string, unknown>
): Promise<string> {
  const id = randomUUID();
  await db
    .insert(gdprRequests)
    .values({ id, shopDomain: shopDomain.slice(0, 255), topic, payload });
  return id;
}

export async function listGdprRequests(shopDomain: string): Promise<GdprRequestRow[]> {
  return db
    .select()
    .from(gdprRequests)
    .where(eq(gdprRequests.shopDomain, shopDomain))
    .orderBy(desc(gdprRequests.receivedAt));
}
