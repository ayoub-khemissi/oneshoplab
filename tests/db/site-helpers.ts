import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { projects, shareLinks } from '@/lib/db/schema';

export async function createProject(userId: string, name = 'Shop'): Promise<string> {
  const id = randomUUID();
  await db.insert(projects).values({ id, userId, name, domain: `${id.slice(0, 8)}.example.com` });
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
