import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { productChanges, products } from '@/shared/db/schema';
import {
  ackChange,
  cancelChange,
  createChange,
  createReverseChange,
  currentFieldValue,
  expireDueChanges,
  hashValue,
  listPendingChanges,
  type ProductChangeRow
} from '@/entities/product-change';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;
let product: { id: string; sourceId: string };

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
  product = await createProduct(projectId, { title: 'Old title' });
});
afterAll(async () => {
  await db.$client.end();
});

async function make(value: unknown = 'New title', extra: { expiresAt?: Date } = {}) {
  const res = await createChange({
    projectId,
    productId: product.id,
    productSourceId: product.sourceId,
    field: 'title',
    value,
    approvedBy: userId,
    ...extra
  });
  if (!res.ok) throw new Error('create failed');
  return res.change;
}
async function row(id: string): Promise<ProductChangeRow> {
  const [r] = await db.select().from(productChanges).where(eq(productChanges.id, id));
  return r;
}

describe('product changes', () => {
  it('create hashes the value and the prior field value', async () => {
    const c = await make({ b: 1, a: [1, 2] });
    expect(c.id).toHaveLength(26);
    expect(c.status).toBe('pending');
    expect(c.valueHash).toBe(hashValue({ a: [1, 2], b: 1 }));
    expect(c.priorValueHash).toBe(hashValue('Old title'));
    expect(c.productSourceId).toBe(product.sourceId);
    const other = await createProject(userId, 'Other');
    expect(
      await createChange({
        projectId: other,
        productId: product.id,
        productSourceId: product.sourceId,
        field: 'title',
        value: 'x',
        approvedBy: userId
      })
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('lists pending oldest first with a ULID cursor and a limit', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await make(`v${i}`)).id);
    const page1 = await listPendingChanges(projectId, { limit: 2 });
    expect(page1.changes.map((c) => c.id)).toEqual(ids.slice(0, 2));
    expect(page1.nextCursor).toBe(ids[1]);
    const page2 = await listPendingChanges(projectId, { since: page1.nextCursor, limit: 2 });
    expect(page2.changes.map((c) => c.id)).toEqual(ids.slice(2, 4));
    const page3 = await listPendingChanges(projectId, { since: page2.nextCursor, limit: 2 });
    expect(page3.changes.map((c) => c.id)).toEqual([ids[4]]);
    expect(page3.nextCursor).toBeNull();
    expect((await listPendingChanges(await createProject(userId, 'X'))).changes).toEqual([]);
  });

  it('ack is idempotent on the same status and 409 on a different one', async () => {
    const c = await make();
    const first = await ackChange(projectId, c.id, { status: 'applied', storeUpdatedAt: 'now' });
    expect(first.kind).toBe('ok');
    expect((await row(c.id)).status).toBe('applied');
    expect((await row(c.id)).ackedAt).toBeInstanceOf(Date);
    expect((await ackChange(projectId, c.id, { status: 'applied' })).kind).toBe('ok');
    expect((await ackChange(projectId, c.id, { status: 'failed' })).kind).toBe('already_acked');
    expect((await listPendingChanges(projectId)).changes).toEqual([]);
    expect(await ackChange(await createProject(userId, 'X'), c.id, { status: 'applied' })).toEqual({
      kind: 'not_found'
    });
  });

  it('a mismatching storeValueHash turns the ack into a conflict', async () => {
    const c = await make();
    const res = await ackChange(projectId, c.id, {
      status: 'applied',
      storeValueHash: hashValue('Edited in the store')
    });
    expect(res.kind === 'ok' && res.change.status).toBe('conflict');
    expect((await row(c.id)).ackPayload?.status).toBe('applied');
    // Re-sending the same ack is idempotent (200), a different status is not.
    expect((await ackChange(projectId, c.id, { status: 'applied' })).kind).toBe('ok');
    expect((await ackChange(projectId, c.id, { status: 'skipped' })).kind).toBe('already_acked');

    const ok = await make('Another');
    const res2 = await ackChange(projectId, ok.id, {
      status: 'applied',
      storeValueHash: hashValue('Old title')
    });
    expect(res2.kind === 'ok' && res2.change.status).toBe('applied');
  });

  it('cancel by the owner; a later ack is already_acked', async () => {
    const c = await make();
    expect(await cancelChange(projectId, c.id, await createUser())).toBe('not_found');
    expect(await cancelChange(projectId, c.id, userId)).toBe('cancelled');
    expect(await cancelChange(projectId, c.id, userId)).toBe('refused');
    expect((await ackChange(projectId, c.id, { status: 'applied' })).kind).toBe('already_acked');
  });

  it('captures prior_value whole, with the image ids (IMAGE-OPS §3)', async () => {
    const c = await make();
    expect(c.priorValue).toBe('Old title');

    const withImages = await createProduct(projectId, {
      sourceId: 'imgs',
      images: [
        {
          src: 'https://cdn.test/1.jpg',
          alt: 'One',
          width: null,
          height: null,
          sourceImageId: 'm1'
        }
      ]
    });
    const res = await createChange({
      projectId,
      productId: withImages.id,
      productSourceId: withImages.sourceId,
      field: 'images',
      value: [{ src: 'https://cdn.test/gen.jpg', alt: null }],
      approvedBy: userId
    });
    expect(res.ok && res.change.priorValue).toEqual([
      { src: 'https://cdn.test/1.jpg', alt: 'One', sourceImageId: 'm1', position: 0 }
    ]);
    // The hash keeps its reduced, plugin-facing shape.
    expect(res.ok && res.change.priorValueHash).toBe(
      hashValue([{ src: 'https://cdn.test/1.jpg', alt: 'One' }])
    );
  });

  it('rejects an images value that is malformed or empties the gallery', async () => {
    const p = await createProduct(projectId, {
      sourceId: 'guard',
      images: [
        { src: 'https://cdn.test/1.jpg', alt: null, width: null, height: null, sourceImageId: 'm1' }
      ]
    });
    const create = (value: unknown) =>
      createChange({
        projectId,
        productId: p.id,
        productSourceId: p.sourceId,
        field: 'images',
        value,
        approvedBy: userId
      });
    expect(await create([])).toEqual({
      ok: false,
      reason: 'invalid_value',
      rejection: { code: 'removes_last_image' }
    });
    expect(await create({ v: 1, ops: [{ op: 'remove', target: 'm1' }] })).toEqual({
      ok: false,
      reason: 'invalid_value',
      rejection: { code: 'removes_last_image' }
    });
    const bad = await create({ v: 1, ops: [{ op: 'reorder', order: ['new:0'] }] });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason === 'invalid_value' && bad.rejection.code).toBe(
      'unknown_image_ref'
    );
    expect((await create({ v: 1, ops: [{ op: 'set_alt', target: 'm1', alt: 'Alt' }] })).ok).toBe(
      true
    );
  });

  it('undo of an applied change queues the reverse change; a moved product is a conflict', async () => {
    const applied = await make('New title');
    expect(await createReverseChange(projectId, applied.id, userId)).toEqual({
      ok: false,
      reason: 'not_applied'
    });
    await ackChange(projectId, applied.id, { status: 'applied' });
    expect(await createReverseChange(projectId, applied.id, await createUser())).toEqual({
      ok: false,
      reason: 'not_found'
    });

    const undo = await createReverseChange(projectId, applied.id, userId);
    expect(undo.ok && undo.change.value).toBe('Old title');
    expect(undo.ok && undo.change.status).toBe('pending');
    // The reverse change is itself undoable: it captured its own prior value —
    // which, since ack now reflects the applied value onto our product row, is
    // the applied title and not the one it replaced.
    expect(undo.ok && undo.change.priorValue).toBe('New title');

    // A later store re-sync writing the same value changes nothing.
    await db.update(products).set({ title: 'New title' }).where(eq(products.id, product.id));
    expect((await createReverseChange(projectId, applied.id, userId)).ok).toBe(true);
    // Merchant edited it since → refused, nothing queued.
    await db.update(products).set({ title: 'Their own edit' }).where(eq(products.id, product.id));
    expect(await createReverseChange(projectId, applied.id, userId)).toEqual({
      ok: false,
      reason: 'conflict'
    });
  });

  it('undo of an images change restores the prior gallery', async () => {
    const p = await createProduct(projectId, {
      sourceId: 'gallery',
      images: [
        {
          src: 'https://cdn.test/1.jpg',
          alt: 'One',
          width: null,
          height: null,
          sourceImageId: 'm1'
        },
        { src: 'https://cdn.test/2.jpg', alt: null, width: null, height: null, sourceImageId: 'm2' }
      ]
    });
    const res = await createChange({
      projectId,
      productId: p.id,
      productSourceId: p.sourceId,
      field: 'images',
      value: [{ src: 'https://cdn.test/gen.jpg', alt: 'Gen' }],
      approvedBy: userId
    });
    if (!res.ok) throw new Error('create failed');
    await ackChange(projectId, res.change.id, { status: 'applied' });
    const undo = await createReverseChange(projectId, res.change.id, userId);
    expect(undo.ok && undo.change.value).toEqual([
      { src: 'https://cdn.test/1.jpg', alt: 'One' },
      { src: 'https://cdn.test/2.jpg', alt: null }
    ]);
    expect(undo.ok && undo.change.field).toBe('images');
    // Applying the reverse restores exactly what the product had.
    const before = await db.select().from(products).where(eq(products.id, p.id));
    expect(undo.ok && hashValue(undo.change.value)).toBe(
      hashValue(currentFieldValue(before[0], 'images'))
    );
  });

  it('expires pending changes past expiresAt', async () => {
    const past = await make('a', { expiresAt: new Date(Date.now() - 1000) });
    const future = await make('b', { expiresAt: new Date(Date.now() + 3600_000) });
    const none = await make('c');
    expect(await expireDueChanges()).toBe(1);
    expect((await row(past.id)).status).toBe('expired');
    expect((await row(future.id)).status).toBe('pending');
    expect((await row(none.id)).status).toBe('pending');
    expect(await expireDueChanges()).toBe(0);
  });
});
