/**
 * A change is a promise to write into a store. When the store goes away —
 * revoked token, uninstalled plugin, rotated key — nothing picks that change
 * up any more, and it used to stay `pending` for ever: the product page kept
 * saying "sending" about a delivery nobody was attempting.
 *
 * Two halves are pinned here: we refuse to make the promise when there is no
 * store to keep it to, and we stop keeping the ones that can no longer be
 * kept.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/shared/db';
import { apiKeys, jobs, productChanges, shopConnections } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { connectProject, createProject } from './site-helpers';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId, plan: 'pro' } } : null)
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { approveOneGeneration } = await import('@/features/apply-to-store/api/actions');
const { failUndeliverableChanges, UNDELIVERABLE_GRACE_MS } =
  await import('@/features/apply-to-store/api/undeliverable');

let userId: string;
let projectId: string;
let productId: string;

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  session.userId = userId;
  projectId = await createProject(userId);
  productId = (await createProduct(projectId, { sourceId: 'p1' })).id;
});
afterAll(async () => {
  await db.$client.end();
});

async function generation(): Promise<string> {
  const id = randomUUID();
  await db.insert(jobs).values({
    id,
    projectId,
    productId,
    kind: 'kie_title',
    status: 'completed',
    inputPayload: { productSourceId: 'p1' },
    result: { output: 'A better title' }
  });
  return id;
}

/** Backdate an approval past the grace window. */
async function age(changeId: string) {
  await db
    .update(productChanges)
    .set({ approvedAt: new Date(Date.now() - UNDELIVERABLE_GRACE_MS - 60_000) })
    .where(eq(productChanges.id, changeId));
}

async function statusOf(changeId: string) {
  const [row] = await db.select().from(productChanges).where(eq(productChanges.id, changeId));
  return row;
}

describe('queueing a change', () => {
  it('is refused when no store can receive it', async () => {
    const res = await approveOneGeneration(userId, 'pro', await generation());
    expect(res).toEqual({ ok: false, error: 'not_connected' });
    expect(await db.select().from(productChanges)).toHaveLength(0);
  });

  it('goes through on a store reachable by its plugin key', async () => {
    await connectProject(projectId, userId);
    expect((await approveOneGeneration(userId, 'pro', await generation())).ok).toBe(true);
  });

  it('goes through on a store reachable by a connector', async () => {
    await db.insert(shopConnections).values({
      id: randomUUID(),
      projectId,
      platform: 'shopify',
      shopDomain: 'demo.myshopify.com',
      accessTokenCiphertext: 'x',
      keyId: 'k1',
      scopes: ['write_products'],
      apiVersion: '2026-01',
      status: 'connected'
    });
    expect((await approveOneGeneration(userId, 'pro', await generation())).ok).toBe(true);
  });
});

describe('failUndeliverableChanges', () => {
  async function queued(): Promise<string> {
    await connectProject(projectId, userId);
    const res = await approveOneGeneration(userId, 'pro', await generation());
    if (!res.ok) throw new Error('fixture could not queue a change');
    return res.change.id;
  }

  it('gives up on a change whose store has gone', async () => {
    const changeId = await queued();
    await db.delete(apiKeys).where(eq(apiKeys.projectId, projectId));
    await age(changeId);

    expect(await failUndeliverableChanges()).toBe(1);
    const row = await statusOf(changeId);
    expect(row.status).toBe('failed');
    expect(row.ackPayload).toMatchObject({ error: 'store_disconnected' });
  });

  it('leaves a change alone while the store is still there', async () => {
    const changeId = await queued();
    await age(changeId);

    expect(await failUndeliverableChanges()).toBe(0);
    expect((await statusOf(changeId)).status).toBe('pending');
  });

  it('waits out the grace window before giving up', async () => {
    // A token refresh or a plugin update takes seconds. Failing a change
    // during one would be a lie the merchant then has to undo.
    const changeId = await queued();
    await db.delete(apiKeys).where(eq(apiKeys.projectId, projectId));

    expect(await failUndeliverableChanges()).toBe(0);
    expect((await statusOf(changeId)).status).toBe('pending');
  });

  it('a revoked key is not a delivery path', async () => {
    const changeId = await queued();
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.projectId, projectId));
    await age(changeId);

    expect(await failUndeliverableChanges()).toBe(1);
    expect((await statusOf(changeId)).status).toBe('failed');
  });

  it('an expired key is not a delivery path', async () => {
    const changeId = await queued();
    await db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiKeys.projectId, projectId));
    await age(changeId);

    expect(await failUndeliverableChanges()).toBe(1);
  });

  it('a key inside its rotation grace still is one', async () => {
    // Rotation is exactly the moment a merchant is least able to afford us
    // throwing their queue away.
    const changeId = await queued();
    await db
      .update(apiKeys)
      .set({ graceUntil: new Date(Date.now() + 60 * 60 * 1000) })
      .where(eq(apiKeys.projectId, projectId));
    await age(changeId);

    expect(await failUndeliverableChanges()).toBe(0);
    expect((await statusOf(changeId)).status).toBe('pending');
  });

  it('a grace window that has run out is not', async () => {
    const changeId = await queued();
    await db
      .update(apiKeys)
      .set({ graceUntil: new Date(Date.now() - 1000) })
      .where(eq(apiKeys.projectId, projectId));
    await age(changeId);

    expect(await failUndeliverableChanges()).toBe(1);
  });

  it('a connection that is not `connected` is not one either', async () => {
    const changeId = await queued();
    await db.delete(apiKeys).where(eq(apiKeys.projectId, projectId));
    await db.insert(shopConnections).values({
      id: randomUUID(),
      projectId,
      platform: 'shopify',
      shopDomain: 'demo.myshopify.com',
      accessTokenCiphertext: 'x',
      keyId: 'k1',
      scopes: ['write_products'],
      apiVersion: '2026-01',
      status: 'token_invalid'
    });
    await age(changeId);

    expect(await failUndeliverableChanges()).toBe(1);
    expect((await statusOf(changeId)).status).toBe('failed');
  });
});
