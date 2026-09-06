import { randomUUID } from 'node:crypto';
import { db } from '@/shared/db';
import { apiKeys, projects, shareLinks } from '@/shared/db/schema';

export async function createProject(userId: string, name = 'Shop'): Promise<string> {
  const id = randomUUID();
  await db.insert(projects).values({ id, userId, name, domain: `${id.slice(0, 8)}.example.com` });
  return id;
}

/**
 * Give a project somewhere to send to.
 *
 * A store that can receive changes is now a precondition for queueing one, so
 * a fixture that omits this is testing a state production cannot reach: the
 * apply flow refuses it, as it should. One usable key is the cheapest honest
 * connection — the same shape the WooCommerce plugin holds.
 */
export async function connectProject(projectId: string, userId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(apiKeys).values({
    id,
    projectId,
    userId,
    name: 'Test plugin',
    prefix: `osl_live_${id.slice(0, 3)}`,
    keyHash: id.replace(/-/g, '').padEnd(64, '0'),
    permissions: ['catalog:write', 'changes:read', 'changes:ack']
  });
  return id;
}

export async function createShareLink(
  userId: string,
  projectId: string,
  opts: { showOnHome?: boolean; revoked?: boolean } = {}
): Promise<string> {
  const id = randomUUID();
  await db.insert(shareLinks).values({
    id,
    userId,
    projectId,
    productSourceIds: ['p1', 'p2'],
    showOnHome: opts.showOnHome ?? false,
    revokedAt: opts.revoked ? new Date() : null
  });
  return id;
}
