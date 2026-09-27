import { and, asc, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import { emitProjectEvent } from '@/entities/outbound-webhook';
import { db } from '@/shared/db';
import { productChanges, products, projects, type ProductChangeField } from '@/shared/db/schema';
import { ulid } from '@/shared/lib';
import { hashValue } from '../lib/hash';
import { appliedGeneratedSources } from '../lib/applied-images';
import {
  checkImageChangeValue,
  isImageOpsPayload,
  type ImageOp,
  type ImageOpsPayload as ImageOpsPayloadValue
} from '../lib/image-ops';
import { withoutTakenAppends } from '../lib/taken-appends';
import { reflectAppliedChange } from './reflect';
import type {
  AckChangeInput,
  AckChangeResult,
  CancelChangeResult,
  DismissChangeResult,
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

/**
 * The field as OSL knows it, kept whole in `prior_value` for "Annuler" and the
 * before/after preview. Images keep their `sourceImageId` and order — that is
 * the difference with `currentFieldValue`, whose reduced shape is frozen by the
 * hash contract shared with the plugins.
 */
export function priorFieldValue(product: ProductFieldSource, field: ProductChangeField): unknown {
  if (field !== 'images') return currentFieldValue(product, field);
  return (product.images ?? []).map((img, i) => ({
    src: img.src,
    alt: img.alt ?? null,
    sourceImageId: img.sourceImageId ?? null,
    position: img.position ?? i
  }));
}

/** Wire shape of `GET /changes` — also the `change.approved` webhook payload. */
export function changeToWire(c: ProductChangeRow) {
  return {
    id: c.id,
    productSourceId: c.productSourceId,
    field: c.field,
    value: c.value,
    sourceJobId: c.sourceJobId,
    approvedAt: c.approvedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null
  };
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

  const priorValue = priorFieldValue(product, input.field);
  if (input.field === 'images' && isImageOpsPayload(input.value)) {
    const dedup = await dedupeImageAppends(input.productId, input.value);
    if (dedup.existing) return { ok: true, change: dedup.existing };
    input = { ...input, value: dedup.value };
  }
  if (input.field === 'images') {
    const check = checkImageChangeValue(input.value, product.images ?? []);
    if (!check.ok) return { ok: false, reason: 'invalid_value', rejection: check.rejection };
  }

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
    priorValue,
    sourceJobId: input.sourceJobId ?? null,
    approvedBy: input.approvedBy,
    expiresAt: input.expiresAt ?? null
  });
  const change = await getChange(input.projectId, id);
  if (!change) return { ok: false, reason: 'not_found' };
  await emitProjectEvent(input.projectId, 'change.approved', changeToWire(change));
  return { ok: true, change };
}

const TAKEN_STATUSES = ['pending', 'applied'] as const;

function opImage(op: ImageOp): { src: string; alt?: string | null } | undefined {
  return 'image' in op ? op.image : undefined;
}

function carriesSrc(op: ImageOp, src: string | undefined): boolean {
  return (
    (op.op === 'append' || op.op === 'replace' || op.op === 'set_featured') &&
    opImage(op)?.src === src
  );
}

/**
 * See `withoutTakenAppends`. An alt typed on the repeat is not lost: it moves
 * onto the pending change that already carries the photo. When nothing is
 * left to send, the caller gets that existing change back.
 */
async function dedupeImageAppends(
  productId: string,
  value: ImageOpsPayloadValue
): Promise<
  { value: ImageOpsPayloadValue; existing: null } | { value: null; existing: ProductChangeRow }
> {
  const rows = await db
    .select()
    .from(productChanges)
    .where(
      and(
        eq(productChanges.productId, productId),
        eq(productChanges.field, 'images'),
        inArray(productChanges.status, [...TAKEN_STATUSES])
      )
    )
    .orderBy(desc(productChanges.id))
    .limit(200);
  const taken = appliedGeneratedSources(rows, TAKEN_STATUSES);
  if (taken.size === 0) return { value, existing: null };
  const { payload, dropped } = withoutTakenAppends(value, taken);
  for (const { src, alt } of dropped) {
    if (!alt) continue;
    const holder = rows.find(
      (r) =>
        r.status === 'pending' &&
        isImageOpsPayload(r.value) &&
        r.value.ops.some((op) => carriesSrc(op, src) && !opImage(op)?.alt)
    );
    if (!holder || !isImageOpsPayload(holder.value)) continue;
    const next = {
      ...holder.value,
      ops: holder.value.ops.map((op) =>
        carriesSrc(op, src) && 'image' in op && op.image
          ? { ...op, image: { ...op.image, alt } }
          : op
      )
    } as ImageOpsPayloadValue;
    await db
      .update(productChanges)
      .set({ value: next, valueHash: hashValue(next) })
      .where(and(eq(productChanges.id, holder.id), eq(productChanges.status, 'pending')));
    holder.value = next;
  }
  if (payload) return { value: payload, existing: null };
  const src = dropped[0]?.src;
  const holder =
    rows.find((r) => isImageOpsPayload(r.value) && r.value.ops.some((op) => carriesSrc(op, src))) ??
    rows[0];
  const fresh = await db.query.productChanges.findFirst({
    where: eq(productChanges.id, holder.id)
  });
  return { value: null, existing: fresh ?? holder };
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
    ...(payload.storeValueHash !== undefined ? { storeValueHash: payload.storeValueHash } : {}),
    ...(payload.skippedOps !== undefined ? { skippedOps: payload.skippedOps } : {})
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
  // The store took it: OSL's own row has to say the same thing, or the
  // merchant reads a title their storefront no longer has.
  if (after.status === 'applied') await reflectAppliedChange(after);
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
  if (res !== 'applied') return 'refused';
  await emitProjectEvent(projectId, 'change.cancelled', {
    id: change.id,
    productSourceId: change.productSourceId,
    field: change.field,
    cancelledAt: new Date().toISOString()
  });
  return 'cancelled';
}

/**
 * "Ignorer" on a failure or a conflict: the merchant has read it and doesn't
 * want it on their dashboard any more. The row keeps its status and its
 * `ack_payload` — support can still see why the store refused it — so this is
 * a display flag, not a state transition. A `pending` row has `cancelChange`.
 */
export async function dismissChange(
  projectId: string,
  id: string,
  userId: string
): Promise<DismissChangeResult> {
  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!owned) return 'not_found';
  const change = await getChange(projectId, id);
  if (!change) return 'not_found';
  if (change.status !== 'failed' && change.status !== 'conflict') return 'refused';
  if (change.dismissedAt) return 'dismissed';
  await db
    .update(productChanges)
    .set({ dismissedAt: new Date() })
    .where(and(eq(productChanges.id, id), eq(productChanges.projectId, projectId)));
  return 'dismissed';
}

/** Worker: pending changes past `expiresAt` become `expired`. */
export async function expireDueChanges(now: Date = new Date()): Promise<number> {
  const [res] = await db
    .update(productChanges)
    .set({ status: 'expired' })
    .where(and(eq(productChanges.status, 'pending'), lte(productChanges.expiresAt, now)));
  return res.affectedRows;
}
