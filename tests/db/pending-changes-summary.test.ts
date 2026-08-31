/**
 * The queries behind the "changes waiting for your store" banner + modal, and
 * the action its Apply button calls. Ownership is re-decided on every read: a
 * counter is a leak as much as a list is.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId, plan: 'pro' } } : null)
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { ackChange, createChange, hashValue } from '@/entities/product-change';
import { applyPendingChangesAction } from '@/features/apply-to-store/actions';
import {
  countPendingByProject,
  listPendingSummaryForProduct,
  listPendingSummaryForSite,
  listPendingSummaryForUser
} from '@/features/apply-to-store/api/queries';
import { db } from '@/shared/db';
import { jobs, productChanges, type ProductChangeField } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

let userId: string;
let otherUserId: string;
let projectId: string;
let product: { id: string; sourceId: string };

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  otherUserId = await createUser();
  projectId = await createProject(userId);
  session.userId = userId;
  product = await createProduct(projectId, { title: 'Old title' });
});
afterAll(async () => {
  await db.$client.end();
});

async function change(
  opts: {
    field?: ProductChangeField;
    value?: unknown;
    productId?: string;
    projectId?: string;
    sourceJobId?: string | null;
  } = {}
) {
  const res = await createChange({
    projectId: opts.projectId ?? projectId,
    productId: opts.productId ?? product.id,
    productSourceId: product.sourceId,
    field: opts.field ?? 'title',
    value: opts.value ?? 'New title',
    sourceJobId: opts.sourceJobId ?? null,
    approvedBy: userId
  });
  if (!res.ok) throw new Error(`create failed: ${JSON.stringify(res)}`);
  return res.change;
}

/** A completed generation the re-send path can replay. */
async function completedJob(output = 'Regenerated title'): Promise<string> {
  const id = randomUUID();
  await db.insert(jobs).values({
    id,
    projectId,
    productId: product.id,
    kind: 'kie_title',
    status: 'completed',
    inputPayload: { productSourceId: product.sourceId },
    result: { output }
  });
  return id;
}

async function fail(id: string, error = 'HTTP 500') {
  await ackChange(projectId, id, { status: 'failed', error });
}

async function conflict(id: string) {
  await ackChange(projectId, id, { status: 'applied', storeValueHash: hashValue('moved') });
}

async function statusOf(id: string): Promise<string> {
  const [row] = await db
    .select({ status: productChanges.status })
    .from(productChanges)
    .where(eq(productChanges.id, id));
  return row.status;
}

describe('pending summary queries', () => {
  it('keeps only the three open statuses and counts them', async () => {
    await change({ field: 'title' });
    await fail((await change({ field: 'description' })).id);
    await conflict((await change({ field: 'tags' })).id);
    await ackChange(projectId, (await change()).id, { status: 'applied' });
    await ackChange(projectId, (await change()).id, { status: 'skipped' });

    const site = await listPendingSummaryForSite(projectId, userId);
    expect(site.counts).toEqual({ total: 3, pending: 1, conflict: 1, failed: 1 });
    expect(new Set(site.items.map((i) => i.status))).toEqual(
      new Set(['pending', 'conflict', 'failed'])
    );
    // Newest first — the modal reads as "what just happened".
    expect([...site.items].sort((a, b) => (a.id < b.id ? 1 : -1))).toEqual(site.items);
  });

  it('refuses to answer for a user who does not own the store', async () => {
    await change();
    expect((await listPendingSummaryForSite(projectId, otherUserId)).counts.total).toBe(0);
    expect((await listPendingSummaryForProduct(product.id, otherUserId)).counts.total).toBe(0);
    expect(await countPendingByProject(otherUserId)).toEqual([]);
    expect((await listPendingSummaryForUser(otherUserId)).counts.total).toBe(0);
  });

  it('scopes the product summary to one product', async () => {
    const other = await createProduct(projectId, { sourceId: 'other', title: 'Apron' });
    await change();
    await change({ productId: other.id });

    const mine = await listPendingSummaryForProduct(product.id, userId);
    expect(mine.counts.total).toBe(1);
    expect(mine.items[0].productTitle).toBe('Old title');
    expect(mine.items[0].productId).toBe(product.id);
    expect((await listPendingSummaryForProduct(other.id, userId)).items[0].productTitle).toBe(
      'Apron'
    );
  });

  it('carries the detail the modal renders, per field', async () => {
    const withImages = await createProduct(projectId, {
      sourceId: 'gallery',
      images: [
        {
          src: 'https://cdn.test/1.jpg',
          alt: null,
          width: null,
          height: null,
          sourceImageId: 'm1'
        },
        { src: 'https://cdn.test/2.jpg', alt: null, width: null, height: null, sourceImageId: 'm2' }
      ]
    });
    await change({ field: 'description', value: '<p>Nice mug</p>' });
    await change({
      field: 'images',
      productId: withImages.id,
      value: { v: 1, ops: [{ op: 'remove', target: 'm2' }] }
    });

    const items = (await listPendingSummaryForSite(projectId, userId)).items;
    const images = items.find((i) => i.field === 'images');
    expect(images?.detail).toEqual({
      kind: 'imageOps',
      ops: [{ op: 'remove', target: 'm2' }],
      prior: [
        { ref: 'm1', src: 'https://cdn.test/1.jpg' },
        { ref: 'm2', src: 'https://cdn.test/2.jpg' }
      ]
    });
    expect(items.find((i) => i.field === 'description')?.detail).toEqual({
      kind: 'text',
      before: null,
      after: 'Nice mug'
    });
  });

  it('reports the plugin error and whether a change can be sent again', async () => {
    const jobId = await completedJob();
    const replayable = await change({ sourceJobId: jobId });
    await fail(replayable.id, 'store said no');
    const orphan = await change({ field: 'description' });
    await fail(orphan.id);

    const items = (await listPendingSummaryForSite(projectId, userId)).items;
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(replayable.id)).toMatchObject({ error: 'store said no', retryable: true });
    expect(byId.get(orphan.id)).toMatchObject({ error: 'HTTP 500', retryable: false });
  });

  it('groups the counters per store for the dashboard cards', async () => {
    const second = await createProject(userId, 'Second');
    const secondProduct = await createProduct(second, { title: 'Board' });
    await change();
    await conflict((await change()).id);
    await createChange({
      projectId: second,
      productId: secondProduct.id,
      productSourceId: secondProduct.sourceId,
      field: 'title',
      value: 'Oak board',
      approvedBy: userId
    });

    const sites = await countPendingByProject(userId);
    expect(sites).toHaveLength(2);
    expect(sites.find((s) => s.projectId === projectId)).toMatchObject({
      total: 2,
      pending: 1,
      conflict: 1,
      failed: 0
    });
    expect(sites.find((s) => s.projectId === second)).toMatchObject({
      projectName: 'Second',
      total: 1,
      pending: 1
    });

    const user = await listPendingSummaryForUser(userId);
    expect(user.counts).toEqual({ total: 3, pending: 2, conflict: 1, failed: 0 });
    expect(user.items).toHaveLength(3);
    expect(user.sites).toHaveLength(2);
  });
});

describe('applyPendingChangesAction', () => {
  it('counts an already pending change as on its way and re-sends a failed one', async () => {
    const waiting = await change();
    const jobId = await completedJob();
    const broken = await change({ sourceJobId: jobId });
    await fail(broken.id);

    const res = await applyPendingChangesAction(projectId, [waiting.id, broken.id]);
    expect(res).toEqual({ ok: true, queued: 2, conflict: 0, failed: 0 });
    // The terminal row stays terminal, but the fresh pending change supersedes
    // it: the merchant sees two rows waiting, not a failure they already fixed.
    expect(await statusOf(broken.id)).toBe('failed');
    const after = await listPendingSummaryForSite(projectId, userId);
    expect(after.counts).toEqual({ total: 2, pending: 2, conflict: 0, failed: 0 });
    expect(await countPendingByProject(userId)).toEqual([
      { projectId, projectName: 'Shop', total: 2, pending: 2, conflict: 0, failed: 0 }
    ]);
  });

  it('reports back what it could not re-send', async () => {
    const orphanConflict = await change({ field: 'title' });
    await conflict(orphanConflict.id);
    const orphanFailed = await change({ field: 'description' });
    await fail(orphanFailed.id);

    expect(
      await applyPendingChangesAction(projectId, [orphanConflict.id, orphanFailed.id])
    ).toEqual({ ok: true, queued: 0, conflict: 1, failed: 1 });
  });

  it('refuses an unknown store, a bad id and a logged-out caller', async () => {
    const waiting = await change();
    expect(await applyPendingChangesAction(projectId, ['nope'])).toEqual({
      ok: false,
      error: 'bad_request'
    });
    expect(await applyPendingChangesAction(projectId, [])).toEqual({
      ok: false,
      error: 'bad_request'
    });
    session.userId = otherUserId;
    expect(await applyPendingChangesAction(projectId, [waiting.id])).toEqual({
      ok: false,
      error: 'not_found'
    });
    session.userId = null;
    expect(await applyPendingChangesAction(projectId, [waiting.id])).toEqual({
      ok: false,
      error: 'unauthorized'
    });
    session.userId = userId;
    expect(await statusOf(waiting.id)).toBe('pending');
  });
});
