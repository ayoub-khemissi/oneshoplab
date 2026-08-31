/**
 * Product loading shared by the two alt-text actions. The image editor reads
 * the `products` row rather than the audit summary because only the row
 * carries `sourceImageId` (docs/api/IMAGE-OPS.md §1) — and a `set_alt` op has
 * nowhere to land without it. The same is true here.
 */
import { and, eq } from 'drizzle-orm';
import type { ProductContext } from '@/entities/generation-job';
import { db } from '@/shared/db';
import { products, projects } from '@/shared/db/schema';
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

/** Store photos of one product that OSL can address and that carry no alt. */
export function missingAltImagesOf(row: OwnedProductRow): AltCandidateProduct {
  const images = (row.images ?? []).flatMap((img) =>
    img.sourceImageId && isMissingAlt(img.alt)
      ? [{ src: img.src, sourceImageId: img.sourceImageId }]
      : []
  );
  return { productId: row.id, title: row.title, images };
}

/** Active products of a project, worst-first is irrelevant here — catalog
 *  order keeps the batch reproducible across two clicks. */
export async function listProjectProducts(projectId: string): Promise<OwnedProductRow[]> {
  return db
    .select()
    .from(products)
    .where(and(eq(products.projectId, projectId), eq(products.status, 'active')));
}
