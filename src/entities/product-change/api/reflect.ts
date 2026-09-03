import { eq } from 'drizzle-orm';
import { emitProjectEvent } from '@/entities/outbound-webhook';
import { getConnection, requestPull } from '@/entities/shop-connection';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
import { isImageOpsPayload, simulateImageOps, type ImageOp } from '../lib/image-ops';
import { parsePriorImages } from '../lib/reverse';
import type { ProductChangeRow } from '../model/types';

type ProductImage = NonNullable<(typeof products.$inferSelect)['images']>[number];

/** Ops that only move, retitle or drop images the store already owns — their
 *  result is fully predictable from what OSL already holds. `append` and
 *  `replace` introduce photos whose store ids only the store knows, so they
 *  are never simulated into our row. */
const ID_PRESERVING: ReadonlySet<ImageOp['op']> = new Set([
  'set_alt',
  'remove',
  'reorder',
  'set_featured'
]);

/**
 * A change the store accepted is the truth about that product — so OSL's own
 * row has to move with it, or the merchant reads a stale title on a page whose
 * store already shows the new one, and the next audit scores what no longer
 * exists.
 *
 * Text fields are written straight away. Images are written only when every op
 * preserves the store's ids and nothing was skipped; otherwise we ask the
 * connector for a fresh catalog, because guessing the id of a photo the store
 * just created would poison every later image op (docs/api/IMAGE-OPS.md §1).
 */
export async function reflectAppliedChange(change: ProductChangeRow): Promise<void> {
  const skipped = change.ackPayload?.skippedOps ?? [];
  if (change.field === 'images') {
    const applied = await reflectImages(change, skipped);
    if (!applied) await requestCatalogRefresh(change.projectId);
    return;
  }
  const patch =
    change.field === 'title'
      ? typeof change.value === 'string' && change.value.trim().length > 0
        ? { title: change.value }
        : null
      : change.field === 'description'
        ? typeof change.value === 'string'
          ? { descriptionHtml: change.value }
          : null
        : Array.isArray(change.value)
          ? { tags: change.value.filter((t): t is string => typeof t === 'string') }
          : null;
  if (!patch) return;
  await db.update(products).set(patch).where(eq(products.id, change.productId));
}

/** @returns true when OSL's row now matches the store without asking it. */
async function reflectImages(change: ProductChangeRow, skipped: string[]): Promise<boolean> {
  if (skipped.length > 0) return false;
  if (!isImageOpsPayload(change.value)) return false;
  const ops = change.value.ops;
  if (!ops.every((op) => ID_PRESERVING.has(op.op))) return false;

  const prior = parsePriorImages(change.priorValue);
  if (prior.length === 0) return false;
  const sim = simulateImageOps(ops, prior);
  if (!sim.ok || sim.simulation.unresolved.length > 0) return false;

  // Rebuild our own shape: the simulation carries src + alt, the prior list
  // carries everything the store owns (ids, dimensions) that must survive.
  const [row] = await db
    .select({ images: products.images })
    .from(products)
    .where(eq(products.id, change.productId));
  const known = new Map((row?.images ?? []).map((img) => [img.src, img]));
  const next: ProductImage[] = sim.simulation.images.map((img, position) => {
    const before = known.get(img.src);
    return {
      src: img.src,
      alt: img.alt,
      width: before?.width ?? null,
      height: before?.height ?? null,
      position,
      sourceImageId: before?.sourceImageId ?? null
    };
  });
  await db.update(products).set({ images: next }).where(eq(products.id, change.productId));
  return true;
}

/**
 * Ask whoever holds this store to send its catalog again. Shopify and Wix are
 * pulled by our worker; a plugin owns the write path, so it can only be told —
 * builds too old to listen simply sync on their next tick.
 */
async function requestCatalogRefresh(projectId: string): Promise<void> {
  try {
    const connection = await getConnection(projectId);
    if (connection?.status === 'connected') {
      await requestPull(projectId);
      return;
    }
    await emitProjectEvent(projectId, 'sync.requested', {
      reason: 'change_applied',
      requestedAt: new Date().toISOString()
    });
  } catch (e) {
    // Never fail an ack over a refresh hint: the change did land in the store.
    console.error('[change] catalog refresh request failed', projectId, e);
  }
}
