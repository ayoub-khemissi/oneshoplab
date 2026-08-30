import { and, asc, eq, gt, lte } from 'drizzle-orm';
import { db } from '@/shared/db';
import { productChanges, products, projects, type ProductChangeField } from '@/shared/db/schema';
import { ulid } from '@/shared/lib';
import { hashValue } from '../lib/hash';
import type {
  AckChangeInput,
  AckChangeResult,
  CancelChangeResult,
  CreateChangeInput,
  CreateChangeResult,
  ListPendingOptions,
  PendingChangesPage,
  ProductChangeRow
} from '../model/types';
import { transitionChange } from './transitions';

export const MAX_CHANGES_PAGE = 200;

type ProductFieldSource = Pick<
  typeof products.$inferSelect,
  'title' | 'descriptionHtml' | 'tags' | 'images'
>;

/** The field as OSL currently knows it, in the shape plugins hash. */
export function currentFieldValue(product: ProductFieldSource, field: ProductChangeField): unknown {
  switch (field) {
    case 'title':
      return product.title;
    case 'description':
      return product.descriptionHtml ?? '';
    case 'tags':
      return product.tags ?? [];
    case 'images':
      return (product.images ?? []).map((i) => ({ src: i.src, alt: i.alt ?? null }));
  }
}

async function getChange(projectId: string, id: string): Promise<ProductChangeRow | null> {
  const [row] = await db
    .select()
    .from(productChanges)
    .where(and(eq(productChanges.projectId, projectId), eq(productChanges.id, id)));
  return row ?? null;
}

/** "Apply to store" on an approved generation → one pending change row. */
export async function createChange(input: CreateChangeInput): Promise<CreateChangeResult> {
  const [product] = await db
    .select({
      title: products.title,
      descriptionHtml: products.descriptionHtml,
      tags: products.tags,
      images: products.images
    })
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.projectId, input.projectId)));
  if (!product) return { ok: false, reason: 'not_found' };

  const id = ulid();
  await db.insert(productChanges).values({
    id,
    projectId: input.projectId,
    productId: input.productId,
    productSourceId: input.productSourceId,
    field: input.field,
    value: input.value,
    valueHash: hashValue(input.value),
    priorValueHash: hashValue(currentFieldValue(product, input.field)),
    sourceJobId: input.sourceJobId ?? null,
    approvedBy: input.approvedBy,
    expiresAt: input.expiresAt ?? null
  });
  const change = await getChange(input.projectId, id);
  if (!change) return { ok: false, reason: 'not_found' };
  return { ok: true, change };
}

/** Oldest first, cursor = last id (ULIDs sort by time). Index-only scan. */
export async function listPendingChanges(
  projectId: string,
  opts: ListPendingOptions = {}
): Promise<PendingChangesPage> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), MAX_CHANGES_PAGE);
  const where = [eq(productChanges.projectId, projectId), eq(productChanges.status, 'pending')];
  if (opts.since) where.push(gt(productChanges.id, opts.since));
  const rows = await db
    .select()
    .from(productChanges)
    .where(and(...where))
    .orderBy(asc(productChanges.id))
    .limit(limit);
  return { changes: rows, nextCursor: rows.length === limit ? rows[rows.length - 1].id : null };
}

/**
 * Plugin acknowledgement (spec §3): idempotent on the same status,
 * `already_acked` on a different one, `conflict` when the plugin's
 * pre-apply hash differs from what OSL had at approval time.
 */
export async function ackChange(
  projectId: string,
  id: string,
  payload: AckChangeInput
): Promise<AckChangeResult> {
  const change = await getChange(projectId, id);
  if (!change) return { kind: 'not_found' };
  if (change.status !== 'pending') {
    if (change.ackPayload && change.ackPayload.status === payload.status) {
      return { kind: 'ok', change };
    }
    return { kind: 'already_acked', change };
  }

  const conflict =
    payload.status === 'applied' &&
    payload.storeValueHash !== undefined &&
    change.priorValueHash !== null &&
    payload.storeValueHash.toLowerCase() !== change.priorValueHash;
  const target = conflict ? 'conflict' : payload.status;
  const ackPayload = {
    status: payload.status,
    ...(payload.error !== undefined ? { error: payload.error } : {}),
    ...(payload.storeUpdatedAt !== undefined ? { storeUpdatedAt: payload.storeUpdatedAt } : {}),
    ...(payload.storeValueHash !== undefined ? { storeValueHash: payload.storeValueHash } : {})
  };
  const result = await transitionChange(
    db,
    id,
    target,
    { ackedAt: new Date(), ackPayload },
    { tolerate: true }
  );
  const after = await getChange(projectId, id);
  if (!after) return { kind: 'not_found' };
  if (result === 'refused') {
    // Lost a race against another ack / a cancel — re-apply the rule.
    return after.ackPayload?.status === payload.status
      ? { kind: 'ok', change: after }
      : { kind: 'already_acked', change: after };
  }
  return { kind: 'ok', change: after };
}

/** Merchant withdraws a pending change (owner check via projects.userId). */
export async function cancelChange(
  projectId: string,
  id: string,
  userId: string
): Promise<CancelChangeResult> {
  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!owned) return 'not_found';
  const change = await getChange(projectId, id);
  if (!change) return 'not_found';
  const res = await transitionChange(db, id, 'cancelled', { ackedAt: null }, { tolerate: true });
  return res === 'applied' ? 'cancelled' : 'refused';
}

/** Worker: pending changes past `expiresAt` become `expired`. */
export async function expireDueChanges(now: Date = new Date()): Promise<number> {
  const [res] = await db
    .update(productChanges)
    .set({ status: 'expired' })
    .where(and(eq(productChanges.status, 'pending'), lte(productChanges.expiresAt, now)));
  return res.affectedRows;
}
