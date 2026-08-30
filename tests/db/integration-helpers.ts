import { randomUUID } from 'node:crypto';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';

export async function createProduct(
  projectId: string,
  opts: { sourceId?: string; title?: string; tags?: string[] } = {}
): Promise<{ id: string; sourceId: string }> {
  const id = randomUUID();
  const sourceId = opts.sourceId ?? `src-${id.slice(0, 8)}`;
  await db.insert(products).values({
    id,
    projectId,
    source: 'shopify',
    sourceId,
    title: opts.title ?? 'Old title',
    tags: opts.tags ?? ['a', 'b']
  });
  return { id, sourceId };
}
