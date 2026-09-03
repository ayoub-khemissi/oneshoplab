import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { ackChange, createChange } from '@/entities/product-change';
import { db } from '@/shared/db';
import { products, projects, users } from '@/shared/db/schema';
import { randomUUID } from 'node:crypto';

/**
 * A change the store accepted must move OSL's own product row with it —
 * otherwise the dashboard shows a title the storefront no longer has, and the
 * next audit scores content that is gone.
 */
describe('reflectAppliedChange', () => {
  const userId = randomUUID();
  const projectId = randomUUID();

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      email: `reflect-${userId}@example.test`,
      name: 'Reflect'
    });
    await db.insert(projects).values({
      id: projectId,
      userId,
      name: 'reflect.test',
      source: 'woocommerce',
      domain: 'reflect.test'
    });
  });

  async function makeProduct(over: Partial<typeof products.$inferInsert> = {}) {
    const id = randomUUID();
    const values: typeof products.$inferInsert = {
      id,
      projectId,
      source: 'woocommerce',
      sourceId: `p-${id.slice(0, 8)}`,
      title: 'Ancien titre',
      descriptionHtml: '<p>ancienne description</p>',
      tags: ['a'],
      images: [
        {
          src: 'https://cdn.test/1.jpg',
          alt: null,
          width: null,
          height: null,
          sourceImageId: '11'
        },
        { src: 'https://cdn.test/2.jpg', alt: null, width: null, height: null, sourceImageId: '22' }
      ],
      status: 'active'
    };
    Object.assign(values, over);
    await db.insert(products).values(values);
    const [row] = await db.select().from(products).where(eq(products.id, id));
    return row;
  }

  async function approve(
    product: Awaited<ReturnType<typeof makeProduct>>,
    field: string,
    value: unknown
  ) {
    const res = await createChange({
      projectId,
      productId: product.id,
      productSourceId: product.sourceId ?? product.id,
      field: field as 'title',
      value,
      approvedBy: userId
    });
    if (!res.ok) throw new Error(`createChange refused: ${res.reason}`);
    return res.change;
  }

  it('writes an applied title onto the product row', async () => {
    const product = await makeProduct();
    const change = await approve(product, 'title', 'Nouveau titre');
    await ackChange(projectId, change.id, { status: 'applied' });
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.title).toBe('Nouveau titre');
  });

  it('writes an applied description and tags', async () => {
    const a = await makeProduct();
    const c1 = await approve(a, 'description', '<p>nouvelle</p>');
    await ackChange(projectId, c1.id, { status: 'applied' });
    const b = await makeProduct();
    const c2 = await approve(b, 'tags', ['x', 'y']);
    await ackChange(projectId, c2.id, { status: 'applied' });
    const [rowA] = await db.select().from(products).where(eq(products.id, a.id));
    const [rowB] = await db.select().from(products).where(eq(products.id, b.id));
    expect(rowA.descriptionHtml).toBe('<p>nouvelle</p>');
    expect(rowB.tags).toEqual(['x', 'y']);
  });

  it('replays a set_alt onto the row, keeping the store ids', async () => {
    const product = await makeProduct();
    const change = await approve(product, 'images', {
      v: 1,
      ops: [{ op: 'set_alt', target: '11', alt: 'Un vase en grès' }]
    });
    await ackChange(projectId, change.id, { status: 'applied' });
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.images?.[0]).toMatchObject({ sourceImageId: '11', alt: 'Un vase en grès' });
    expect(row.images?.[1]).toMatchObject({ sourceImageId: '22' });
  });

  it('leaves the row alone when the store skipped an op', async () => {
    const product = await makeProduct();
    const change = await approve(product, 'images', {
      v: 1,
      ops: [{ op: 'set_alt', target: '11', alt: 'Jamais posé' }]
    });
    await ackChange(projectId, change.id, { status: 'applied', skippedOps: ['0:set_alt'] });
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row.images?.[0].alt).toBeNull();
  });

  it('does not touch the row on a failed ack', async () => {
    const product = await makeProduct();
    const change = await approve(product, 'title', 'Titre refusé');
    await ackChange(projectId, change.id, { status: 'failed', error: 'nope' });
    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, product.id), eq(products.projectId, projectId)));
    expect(row.title).toBe('Ancien titre');
  });
});
