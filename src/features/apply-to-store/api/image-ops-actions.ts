'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { imageRetentionDaysForPlan } from '@/entities/ai-model';
import { getProjectCapabilities } from '@/entities/connection-capability';
import {
  MAX_IMAGE_OPS,
  createChange,
  imageOpSchema,
  simulateImageOps,
  type ImageOp
} from '@/entities/product-change';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { products, projects } from '@/shared/db/schema';
import { toChangeSummary } from '../lib/summary';
import type { ImageOpsResult } from '../model/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const opsSchema = z.array(imageOpSchema).min(1).max(MAX_IMAGE_OPS);
const uuid = z.string().uuid();

/** Targets that address the store (a `new:<n>` one is created by the payload itself). */
function storeTargets(ops: readonly ImageOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if ('target' in op && op.target && !op.target.startsWith('new:')) out.push(op.target);
    if (op.op === 'reorder') {
      for (const ref of op.order) if (!ref.startsWith('new:')) out.push(ref);
    }
  }
  return out;
}

/**
 * The editor's "Appliquer" (docs/api/IMAGE-OPS.md §4): one reviewed queue → ONE
 * pending `product_changes` row carrying the ops payload, which the existing
 * apply/undo pipeline takes to the store.
 *
 * Everything the client decided is decided again here — ownership, the verbs
 * the connection actually declared, the photo cap, the last-image rule, and
 * whether the targeted photos still exist in OSL's view of the gallery. A
 * client is a suggestion, never an authority.
 */
export async function approveImageOpsAction(
  productId: string,
  ops: unknown
): Promise<ImageOpsResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const id = uuid.safeParse(productId);
  const parsed = opsSchema.safeParse(ops);
  if (!id.success || !parsed.success) return { ok: false, error: 'bad_request' };

  const [row] = await db
    .select({ product: products, projectId: projects.id })
    .from(products)
    .innerJoin(projects, eq(projects.id, products.projectId))
    .where(and(eq(products.id, id.data), eq(projects.userId, session.user.id)));
  if (!row) return { ok: false, error: 'not_found' };
  if (row.product.status === 'archived') return { ok: false, error: 'archived' };

  const capabilities = await getProjectCapabilities(row.projectId);
  if (!capabilities.stableImageIds) return { ok: false, error: 'unsupported' };
  if (parsed.data.some((op) => !capabilities.imageOps.includes(op.op))) {
    return { ok: false, error: 'unsupported' };
  }

  const prior = row.product.images ?? [];
  // A target the merchant's screen still shows but the gallery no longer has:
  // the store moved since the page loaded. Saying so beats queueing a change
  // whose ops the store would silently skip.
  const known = new Set(prior.map((img, i) => img.sourceImageId ?? `pos:${i}`));
  if (storeTargets(parsed.data).some((t) => !known.has(t))) {
    return { ok: false, error: 'stale' };
  }
  const simulation = simulateImageOps(parsed.data, prior);
  if (!simulation.ok) {
    return {
      ok: false,
      error: simulation.rejection.code === 'removes_last_image' ? 'last_image' : 'bad_request'
    };
  }
  if (simulation.simulation.images.length > capabilities.maxImages) {
    return { ok: false, error: 'too_many_images', max: capabilities.maxImages };
  }

  // Generated visuals die with the plan's retention window, so a change that
  // carries one must reach the store before that (same deadline as §"apply").
  const carriesImage = parsed.data.some((op) => 'image' in op && op.image);
  const expiresAt = carriesImage
    ? new Date(Date.now() + imageRetentionDaysForPlan(session.user.plan ?? 'free') * DAY_MS)
    : null;

  const created = await createChange({
    projectId: row.projectId,
    productId: row.product.id,
    productSourceId: row.product.sourceId ?? row.product.handle ?? row.product.id,
    field: 'images',
    value: { v: 1, ops: parsed.data },
    approvedBy: session.user.id,
    expiresAt
  });
  if (!created.ok) {
    if (created.reason === 'not_found') return { ok: false, error: 'not_found' };
    return {
      ok: false,
      error: created.rejection.code === 'removes_last_image' ? 'last_image' : 'bad_request'
    };
  }
  revalidatePath(`/dashboard/sites/${row.projectId}/products/${row.product.id}`);
  revalidatePath(`/dashboard/sites/${row.projectId}`);
  return { ok: true, change: toChangeSummary(created.change) };
}
