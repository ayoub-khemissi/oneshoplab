/**
 * "Send everything" replaces one Apply click per generated field. The rule that
 * matters is which generations it picks: the newest per product and field, and
 * only those no change already carries. Getting it wrong either floods a
 * merchant's store with superseded text or silently sends nothing.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/shared/db';
import { jobs, productChanges, projects, type JobKind } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject, connectProject } from './site-helpers';

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/entities/user', () => ({
  auth: async () => ({ user: { id: session.userId, plan: 'pro' } })
}));

const { countSendableGenerationsAction, sendAllGenerationsAction } =
  await import('@/features/apply-to-store/api/send-all');

let userId: string;
let projectId: string;

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  session.userId = userId;
  projectId = await createProject(userId);
  await connectProject(projectId, userId);
});
afterAll(async () => {
  await db.$client.end();
});

/** A completed generation, as the worker leaves it behind. */
async function generation(
  productId: string,
  kind: JobKind,
  output: string,
  createdAt = new Date()
) {
  const id = randomUUID();
  await db.insert(jobs).values({
    id,
    projectId,
    productId,
    kind,
    status: 'completed',
    result: { output },
    createdAt
  });
  return id;
}

describe('send all generations', () => {
  it('sends one change per generated field, and nothing twice', async () => {
    const product = await createProduct(projectId, { sourceId: 'p1' });
    await generation(product.id, 'kie_title', 'A better title');
    await generation(product.id, 'kie_description', '<p>A better description</p>');

    expect(await countSendableGenerationsAction(projectId)).toBe(2);
    expect(await sendAllGenerationsAction(projectId)).toMatchObject({ ok: true, queued: 2 });

    const rows = await db
      .select()
      .from(productChanges)
      .where(eq(productChanges.projectId, projectId));
    expect(rows.map((r) => r.field).sort()).toEqual(['description', 'title']);

    // Everything is queued now, so a second click has nothing to do.
    expect(await countSendableGenerationsAction(projectId)).toBe(0);
    expect(await sendAllGenerationsAction(projectId)).toMatchObject({ queued: 0 });
    expect(
      await db.select().from(productChanges).where(eq(productChanges.projectId, projectId))
    ).toHaveLength(2);
  });

  it('keeps only the newest generation of a field', async () => {
    const product = await createProduct(projectId, { sourceId: 'p1' });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await generation(product.id, 'kie_title', 'Superseded title', old);
    const newest = await generation(product.id, 'kie_title', 'Newest title');

    expect(await countSendableGenerationsAction(projectId)).toBe(1);
    await sendAllGenerationsAction(projectId);

    const [row] = await db
      .select()
      .from(productChanges)
      .where(eq(productChanges.projectId, projectId));
    expect(row.sourceJobId).toBe(newest);
    expect(row.value).toBe('Newest title');
  });

  it('scoped to one product leaves the rest of the store alone', async () => {
    const a = await createProduct(projectId, { sourceId: 'a' });
    const b = await createProduct(projectId, { sourceId: 'b' });
    await generation(a.id, 'kie_title', 'Title A');
    await generation(b.id, 'kie_title', 'Title B');

    expect(await countSendableGenerationsAction(projectId, a.id)).toBe(1);
    await sendAllGenerationsAction(projectId, a.id);

    const rows = await db
      .select()
      .from(productChanges)
      .where(eq(productChanges.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe(a.id);
    // The other product is still waiting, and the store-wide count says so.
    expect(await countSendableGenerationsAction(projectId)).toBe(1);
  });

  it('refuses a project the caller does not own', async () => {
    const stranger = await createUser();
    const theirProject = await createProject(stranger);
    await connectProject(theirProject, stranger);
    const theirProduct = await createProduct(theirProject, { sourceId: 'x' });
    await db.insert(jobs).values({
      id: randomUUID(),
      projectId: theirProject,
      productId: theirProduct.id,
      kind: 'kie_title',
      status: 'completed',
      result: { output: 'Not yours' }
    });

    expect(await countSendableGenerationsAction(theirProject)).toBe(0);
    expect(await sendAllGenerationsAction(theirProject)).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(await db.select().from(productChanges)).toHaveLength(0);
  });

  it('ignores generations that never finished', async () => {
    const product = await createProduct(projectId, { sourceId: 'p1' });
    await db.insert(jobs).values({
      id: randomUUID(),
      projectId,
      productId: product.id,
      kind: 'kie_title',
      status: 'running'
    });
    expect(await countSendableGenerationsAction(projectId)).toBe(0);
  });

  it('says nothing to send on a store with no generations', async () => {
    expect(await countSendableGenerationsAction(projectId)).toBe(0);
    expect(await sendAllGenerationsAction(projectId)).toMatchObject({ ok: true, queued: 0 });
    expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(1);
  });
});
