/**
 * "Annuler" (docs/api/IMAGE-OPS.md §3): an applied change is undone by
 * *another* change that restores `prior_value` — never by rewriting history.
 * The reverse row goes through the same pending → apply → ack path, so every
 * executor, conflict check and audit trail keeps working unchanged.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/shared/db';
import { productChanges, products, projects } from '@/shared/db/schema';
import { hashValue } from '../lib/hash';
import { expectedImagesAfter } from '../lib/image-ops';
import { buildReverseValue, parsePriorImages } from '../lib/reverse';
import type { ProductChangeRow, ReverseChangeResult } from '../model/types';
import { createChange, currentFieldValue } from './changes';

type ProductRow = Pick<
  typeof products.$inferSelect,
  'id' | 'title' | 'descriptionHtml' | 'tags' | 'images'
>;

/**
 * OSL's copy of the field must be either what we wrote (the store re-synced and
 * nobody touched it) or what was there before (no sync yet). Anything else is
 * the merchant's own edit — restoring would silently overwrite it.
 */
function movedSince(change: ProductChangeRow, product: ProductRow): boolean {
  const current = hashValue(currentFieldValue(product, change.field));
  if (change.priorValueHash && current === change.priorValueHash) return false;
  if (change.field !== 'images') return current !== change.valueHash;
  const expected = expectedImagesAfter(change.value, parsePriorImages(change.priorValue));
  return expected === null || current !== hashValue(expected);
}

export async function createReverseChange(
  projectId: string,
  changeId: string,
  userId: string
): Promise<ReverseChangeResult> {
  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!owned) return { ok: false, reason: 'not_found' };

  const [change] = await db
    .select()
    .from(productChanges)
    .where(and(eq(productChanges.projectId, projectId), eq(productChanges.id, changeId)));
  if (!change) return { ok: false, reason: 'not_found' };
  if (change.status !== 'applied') return { ok: false, reason: 'not_applied' };
  if (change.priorValue === null || change.priorValue === undefined) {
    return { ok: false, reason: 'no_prior' };
  }

  const [product] = await db
    .select({
      id: products.id,
      title: products.title,
      descriptionHtml: products.descriptionHtml,
      tags: products.tags,
      images: products.images
    })
    .from(products)
    .where(and(eq(products.id, change.productId), eq(products.projectId, projectId)));
  if (!product) return { ok: false, reason: 'not_found' };
  if (movedSince(change, product)) return { ok: false, reason: 'conflict' };

  const reverse = buildReverseValue(change.field, change.priorValue, change.value);
  if (!reverse.ok) return { ok: false, reason: reverse.reason };

  const created = await createChange({
    projectId,
    productId: change.productId,
    productSourceId: change.productSourceId,
    field: change.field,
    value: reverse.value,
    // The restored images are the merchant's own media URLs, not R2 generations:
    // no retention deadline applies to a reverse change.
    sourceJobId: null,
    approvedBy: userId
  });
  if (!created.ok) {
    return { ok: false, reason: created.reason === 'not_found' ? 'not_found' : 'not_reversible' };
  }
  return { ok: true, change: created.change };
}
