/**
 * Product loading shared by the two alt-text actions. The image editor reads
 * the `products` row rather than the audit summary because only the row
 * carries `sourceImageId` (docs/api/IMAGE-OPS.md §1) — and a `set_alt` op has
 * nowhere to land without it. The same is true here.
 */
import { and, eq } from 'drizzle-orm';
import type { ProductContext } from '@/entities/generation-job';
import type { ImageOp } from '@/entities/product-change/client';
import { db } from '@/shared/db';
import { productChanges, products, projects } from '@/shared/db/schema';
import type { AltCandidateProduct } from '../lib/batch';
import { isMissingAlt } from '../lib/batch';

export type OwnedProductRow = typeof products.$inferSelect;

/** Ownership is the join, not a second query: a product only exists for a
 *  user through a project they own. */
export async function loadOwnedProduct(
  userId: string,
  productId: string
): Promise<{ product: OwnedProductRow; projectId: string } | null> {
  const [row] = await db
    .select({ product: products, projectId: projects.id })
    .from(products)
    .innerJoin(projects, eq(projects.id, products.projectId))
    .where(and(eq(products.id, productId), eq(projects.userId, userId)));
  return row ?? null;
}

export async function ownsProject(userId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return Boolean(row);
}

/**
 * The context block of the alt prompt. It exists so the model names the object
 * correctly ("mug en grès", not "tasse"), never so it can restate the catalog
 * — hence no description, no price: an alt text describes a photo.
 */
export function toAltProductContext(row: OwnedProductRow): ProductContext {
  return {
    title: row.title,
    descriptionText: '',
    vendor: row.vendor,
    productType: row.productType,
    tags: (row.tags ?? []) as string[],
    imageCount: (row.images ?? []).length,
    priceMin: null,
    priceMax: null,
    currency: null
  };
}

/** The key `jobs.input_payload.productSourceId` is written with. */
export function sourceKeyOf(row: OwnedProductRow): string {
  return row.sourceId ?? row.handle ?? row.id;
}

/** `productId:sourceImageId` of every photo whose alt is already written and
 *  waiting in a pending change. The products row only learns the alt when
 *  the change is applied, so without this a second click would describe —
 *  and bill — the same photos again, and the button would never go away. */
export async function pendingAltTargets(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ productId: productChanges.productId, value: productChanges.value })
    .from(productChanges)
    .where(
      and(
        eq(productChanges.projectId, projectId),
        eq(productChanges.field, 'images'),
        eq(productChanges.status, 'pending')
      )
    );
  const covered = new Set<string>();
  for (const r of rows) {
    const ops = (r.value as { ops?: ImageOp[] } | null)?.ops ?? [];
    for (const op of ops) {
      if (op.op === 'set_alt' && r.productId) covered.add(`${r.productId}:${op.target}`);
    }
  }
  return covered;
}

/** Store photos of one product that OSL can address, that carry no alt, and
 *  that no pending change is already about to describe. */
export function missingAltImagesOf(
  row: OwnedProductRow,
  covered: ReadonlySet<string> = new Set()
): AltCandidateProduct {
  const images = (row.images ?? []).flatMap((img) =>
    img.sourceImageId && isMissingAlt(img.alt) && !covered.has(`${row.id}:${img.sourceImageId}`)
      ? [{ src: img.src, sourceImageId: img.sourceImageId }]
      : []
  );
  return { productId: row.id, title: row.title, images };
}

/** Live count behind the "generate the missing alt texts" button: the
 *  products table minus what is already queued. The audit's own tally is a
 *  snapshot that only moves on the next audit, which is how the button kept
 *  offering photos whose alt was already waiting to be sent. */
export async function countMissingAlt(projectId: string): Promise<number> {
  const [rows, covered] = await Promise.all([
    listProjectProducts(projectId),
    pendingAltTargets(projectId)
  ]);
  return rows.reduce((n, row) => n + missingAltImagesOf(row, covered).images.length, 0);
}

/** Active products of a project, worst-first is irrelevant here — catalog
 *  order keeps the batch reproducible across two clicks. */
export async function listProjectProducts(projectId: string): Promise<OwnedProductRow[]> {
  return db
    .select()
    .from(products)
    .where(and(eq(products.projectId, projectId), eq(products.status, 'active')));
}
