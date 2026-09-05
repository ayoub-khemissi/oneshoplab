/**
 * Auto-send writes into a live catalogue with no review step, so the rule that
 * decides WHICH stores it touches is the one worth pinning: only those that
 * asked, and only their own generations.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/shared/db';
import { jobs, productChanges, projects } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/entities/user', () => ({ auth: async () => null }));

const { autoSendCompletedGenerations, setAutoApply } =
  await import('@/features/apply-to-store/api/auto-send');

let userId: string;
let projectId: string;

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
});
afterAll(async () => {
  await db.$client.end();
});

async function generation(project: string, productId: string, output = 'A better title') {
  await db.insert(jobs).values({
    id: randomUUID(),
    projectId: project,
    productId,
    kind: 'kie_title',
    status: 'completed',
    result: { output }
  });
}

async function changesFor(project: string) {
  return db.select().from(productChanges).where(eq(productChanges.projectId, project));
}

describe('autoSendCompletedGenerations', () => {
  it('touches nothing while the store has not asked for it', async () => {
    const product = await createProduct(projectId, { sourceId: 'p1' });
    await generation(projectId, product.id);

    expect(await autoSendCompletedGenerations()).toBe(0);
    expect(await changesFor(projectId)).toHaveLength(0);
  });

  it('sends the waiting generations once the store opts in', async () => {
    const product = await createProduct(projectId, { sourceId: 'p1' });
    await generation(projectId, product.id);
    expect(await setAutoApply(projectId, userId, true)).toBe(true);

    expect(await autoSendCompletedGenerations()).toBe(1);
    const [change] = await changesFor(projectId);
    expect(change.value).toBe('A better title');

    // Nothing left: the pass is a no-op until a new generation lands.
    expect(await autoSendCompletedGenerations()).toBe(0);
    expect(await changesFor(projectId)).toHaveLength(1);
  });

  it('leaves every other store alone', async () => {
    const otherUser = await createUser();
    const otherProject = await createProject(otherUser);
    const mine = await createProduct(projectId, { sourceId: 'a' });
    const theirs = await createProduct(otherProject, { sourceId: 'b' });
    await generation(projectId, mine.id);
    await generation(otherProject, theirs.id);
    await setAutoApply(projectId, userId, true);

    await autoSendCompletedGenerations();
    expect(await changesFor(projectId)).toHaveLength(1);
    expect(await changesFor(otherProject)).toHaveLength(0);
  });

  it('stops when the store turns it back off', async () => {
    const product = await createProduct(projectId, { sourceId: 'p1' });
    await setAutoApply(projectId, userId, true);
    await setAutoApply(projectId, userId, false);
    await generation(projectId, product.id);

    expect(await autoSendCompletedGenerations()).toBe(0);
    expect(await changesFor(projectId)).toHaveLength(0);
  });

  it('refuses to flip a store the caller does not own', async () => {
    const stranger = await createUser();
    expect(await setAutoApply(projectId, stranger, true)).toBe(false);
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(row.autoApply).toBe(false);
  });
});
