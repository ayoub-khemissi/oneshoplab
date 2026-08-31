import { randomUUID } from 'node:crypto';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';

type ProductImages = NonNullable<(typeof products.$inferInsert)['images']>;

export async function createProduct(
  projectId: string,
  opts: {
    sourceId?: string;
    title?: string;
    tags?: string[];
    images?: ProductImages;
  } = {}
): Promise<{ id: string; sourceId: string }> {
  const id = randomUUID();
  const sourceId = opts.sourceId ?? `src-${id.slice(0, 8)}`;
  await db.insert(products).values({
    id,
    projectId,
    source: 'shopify',
    sourceId,
    title: opts.title ?? 'Old title',
    tags: opts.tags ?? ['a', 'b'],
    ...(opts.images ? { images: opts.images } : {})
  });
  return { id, sourceId };
}
