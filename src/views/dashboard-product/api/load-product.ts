import { and, eq } from 'drizzle-orm';
import { DEMO_PRODUCT_ID } from '@/shared/lib';
import { db } from '@/shared/db';
import { products, projects } from '@/shared/db/schema';
import type { LoadedProduct, ProductImage, ProductSnapshot, ProductVariant } from '../model/types';

export type {
  LoadedProduct,
  ProductImage,
  ProductSnapshot,
  ProductVariant,
  StoreImage
} from '../model/types';

interface SummaryShape {
  worstProducts?: ProductSnapshot[];
  bestProducts?: ProductSnapshot[];
  latestProducts?: ProductSnapshot[];
  allProducts?: ProductSnapshot[];
}

// ============================================================================
// Data loading
// ============================================================================

export async function loadProductForUser(
  userId: string,
  siteId: string,
  productId: string
): Promise<LoadedProduct | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.id, siteId))
  });
  if (!project) return null;

  // The tour's sample sheet. Ownership of the site is still checked above —
  // only the product is synthetic, and it never reaches the database.
  if (productId === DEMO_PRODUCT_ID) {
    const { demoLoadedProduct } = await import('./demo-product');
    return demoLoadedProduct(project.id);
  }

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, project.id))
  });
  if (!productRow) return null;

  const { findLatestAuditForProject } = await import('@/entities/audit');
  const audit = await findLatestAuditForProject(project.id, project.domain);

  const summary = (audit?.summary ?? null) as SummaryShape | null;

  let product: ProductSnapshot | null = null;
  if (summary) {
    const all = [
      ...(summary.allProducts ?? []),
      ...(summary.worstProducts ?? []),
      ...(summary.latestProducts ?? []),
      ...(summary.bestProducts ?? [])
    ];
    // Match strategy is sourceId-first ACROSS THE WHOLE ARRAY, then
    // handle as a strict fallback. Some upstream platforms emit the
    // same handle for many distinct products (WooCommerce slug
    // collisions, recycled slugs after a delete-and-recreate, …),
    // so a per-item `sourceId || handle` check would return the
    // wrong row whenever a handle collision lives earlier in the
    // array than the actual sourceId. Two passes is cheap (O(n))
    // and unambiguous.
    const byId = productRow.sourceId
      ? all.find((p) => p.sourceId === productRow.sourceId)
      : undefined;
    const byHandle =
      !byId && productRow.handle ? all.find((p) => p.handle === productRow.handle) : undefined;
    const match = byId ?? byHandle ?? null;
    if (match) {
      // productRow stays the canonical source for the join key the
      // rest of the page uses (sourceId / handle drive history
      // lookups against jobs.input_payload.productSourceId). The
      // summary's sourceId can be re-issued by the upstream store
      // for the same handle on a re-scrape — using it would
      // silently invalidate every historical generation. So we
      // overlay the summary's score / signals onto the productRow
      // identifiers, never the other way around.
      product = {
        ...match,
        sourceId: productRow.sourceId,
        handle: productRow.handle,
        url: match.url ?? productRow.sourceUrl,
        title: match.title || productRow.title
      };
    }
  }

  // Archived path: product is missing from the latest summary OR explicitly
  // flagged on the products row. Synthesize a snapshot from the persisted
  // metadata so the page still renders (banner + disabled CTAs handled
  // downstream). The score is unknown here — show 0 / "—" downstream.
  if (!product || productRow.status === 'archived') {
    product = {
      sourceId: productRow.sourceId,
      handle: productRow.handle,
      title: productRow.title,
      url: productRow.sourceUrl,
      descriptionHtml: productRow.descriptionHtml ?? '',
      images: (productRow.images ?? []) as ProductImage[],
      variants: ((productRow.variants ?? []) as unknown as ProductVariant[]) ?? [],
      score: product?.score ?? 0,
      signals: {
        tags: (productRow.tags ?? []) as string[],
        vendor: productRow.vendor,
        productType: productRow.productType,
        priceMin: productRow.priceMin != null ? Number(productRow.priceMin) : null,
        priceMax: productRow.priceMax != null ? Number(productRow.priceMax) : null
      }
    };
  }

  return {
    projectId: project.id,
    product,
    storeImages: (productRow.images ?? []).map((img) => ({
      src: img.src,
      alt: img.alt ?? null,
      sourceImageId: img.sourceImageId ?? null
    })),
    archived: productRow.status === 'archived',
    productInstructions: productRow.customInstructions ?? '',
    productImagePrompt: productRow.customImagePrompt ?? '',
    projectInstructions: project.customInstructions ?? '',
    isManual: project.source === 'manual'
  };
}
