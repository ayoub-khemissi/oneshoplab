/**
 * Pure planning of the "generate the missing alt texts" batch. Nothing here
 * touches the db or the provider, so the two rules that decide what a click
 * costs the merchant — which photos count as missing, and how many are done
 * per run — are unit-tested rather than eyeballed.
 */
import type { ImageOp } from '@/entities/product-change/client';

/**
 * One run stops here. Each image is a vision call of ~2-4 s, so 25 is about a
 * minute of visible progress — long enough to be worth a batch, short enough
 * that the merchant is not left staring at a bar, and small enough that a
 * mistaken click costs ~25 credits, not a catalog. The rest of the catalog is
 * one more click away; the button says how many are left.
 */
export const ALT_BATCH_MAX_IMAGES = 25;

/** A photo the store can address and that carries no alternative text. */
export interface AltCandidateImage {
  src: string;
  /** The store's own id — a `set_alt` op has nowhere to land without it. */
  sourceImageId: string;
}

export interface AltCandidateProduct {
  productId: string;
  title: string;
  images: AltCandidateImage[];
}

export interface AltBatchPlan {
  /** Products to run, truncated to the cap (a product may be partly included). */
  products: AltCandidateProduct[];
  /** Photos this run would describe. */
  images: number;
  /** Photos still missing an alt text after this run. */
  remaining: number;
}

export function isMissingAlt(alt: string | null | undefined): boolean {
  return !alt || alt.trim().length === 0;
}

/**
 * Fills the run image by image so a catalog whose first product has 30 photos
 * still makes progress instead of blocking the whole batch on a single row.
 */
export function planAltBatch(
  candidates: readonly AltCandidateProduct[],
  max: number = ALT_BATCH_MAX_IMAGES
): AltBatchPlan {
  const products: AltCandidateProduct[] = [];
  let used = 0;
  let total = 0;
  for (const c of candidates) {
    total += c.images.length;
    const room = max - used;
    if (room <= 0) continue;
    const images = c.images.slice(0, room);
    if (images.length === 0) continue;
    products.push({ ...c, images });
    used += images.length;
  }
  return { products, images: used, remaining: total - used };
}

/**
 * One `images` change per product carrying ONLY `set_alt` ops: alt text is the
 * one image action that never touches the merchant's visuals (IMAGE-OPS.md
 * §4), so the batch must not slip a reorder or a removal in beside it.
 */
export function buildSetAltOps(
  images: readonly AltCandidateImage[],
  altBySourceImageId: Readonly<Record<string, string>>
): ImageOp[] {
  return images.flatMap((img) => {
    const alt = altBySourceImageId[img.sourceImageId];
    return alt && alt.trim().length > 0
      ? [{ op: 'set_alt' as const, target: img.sourceImageId, alt: alt.trim() }]
      : [];
  });
}

/**
 * How many photos the latest audit reported without an alt text. Drives the
 * button's count: `missing_alt_text` is exactly the issue this action clears,
 * so the number the merchant reads on the button is the number they read in
 * their report. The action recounts against the products table before
 * spending anything — the audit is a snapshot, not an authority.
 */
export function countMissingAltFromIssues(
  products: ReadonlyArray<{
    issues?: ReadonlyArray<{ code: string; data?: Record<string, unknown> }>;
  }>
): number {
  let missing = 0;
  for (const p of products) {
    for (const issue of p.issues ?? []) {
      if (issue.code !== 'missing_alt_text') continue;
      const n = Number(issue.data?.missing ?? 0);
      if (Number.isFinite(n) && n > 0) missing += n;
    }
  }
  return missing;
}
