import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { productChanges } from '@/shared/db/schema';
import {
  ackChange,
  cancelChange,
  createChange,
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
