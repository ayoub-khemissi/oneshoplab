import type { ImportRowInput, RowValidation } from './normalize';

/**
 * Decide, row by row, what the import will do. Pure: the server hands it the
 * catalogue index it built, the browser shows the outcome before anything is
 * written.
 *
 * Matching precedence: SKU, then handle, then the normalised title. A match
 * means the existing product is UPDATED, never duplicated; the merchant asked
 * for that behaviour and it is what a re-import of the same file needs to be
 * safe. A second row in the same file for the same product is skipped, so a
 * file with an accidental duplicate does not write twice.
 */
export type RowAction = 'create' | 'update' | 'skip' | 'reject';

export type SkipReason = 'duplicate_in_file' | 'plan_limit' | 'invalid' | 'no_image';

export interface ExistingProduct {
  id: string;
  sku: string | null;
  handle: string | null;
  title: string;
}

export interface ExistingIndex {
  bySku: Map<string, string>;
  byHandle: Map<string, string>;
  byTitle: Map<string, string>;
}

export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function indexExisting(products: readonly ExistingProduct[]): ExistingIndex {
  const idx: ExistingIndex = { bySku: new Map(), byHandle: new Map(), byTitle: new Map() };
  for (const p of products) {
    if (p.sku) idx.bySku.set(p.sku.trim().toLowerCase(), p.id);
    if (p.handle) idx.byHandle.set(p.handle.toLowerCase(), p.id);
    idx.byTitle.set(normalizeTitleKey(p.title), p.id);
  }
  return idx;
}

export function matchExisting(input: ImportRowInput, idx: ExistingIndex): string | null {
  if (input.sku) {
    const hit = idx.bySku.get(input.sku.trim().toLowerCase());
    if (hit) return hit;
  }
  if (input.handle) {
    const hit = idx.byHandle.get(input.handle.toLowerCase());
    if (hit) return hit;
  }
  return idx.byTitle.get(normalizeTitleKey(input.title)) ?? null;
}

/** Identity of a row inside the file, for the in-file duplicate check. */
function fileKey(input: ImportRowInput): string {
  if (input.sku) return `sku:${input.sku.trim().toLowerCase()}`;
  if (input.handle) return `handle:${input.handle.toLowerCase()}`;
  return `title:${normalizeTitleKey(input.title)}`;
}

export interface PlannedRow {
  row: number;
  action: RowAction;
  reason?: SkipReason;
  /** Set on `update`: the product the row will overwrite. */
  productId?: string;
  input: ImportRowInput | null;
  errors: RowValidation['errors'];
  warnings: RowValidation['warnings'];
}

export interface ImportPlan {
  rows: PlannedRow[];
  counts: { create: number; update: number; skip: number; reject: number };
  /** Creates that could not fit under the plan's product limit. */
  overLimit: number;
}

/**
 * @param room  how many more products the plan allows on this site right now.
 */
export function planImport(
  validations: readonly RowValidation[],
  existing: ExistingIndex,
  room: number
): ImportPlan {
  const seen = new Set<string>();
  const counts = { create: 0, update: 0, skip: 0, reject: 0 };
  let left = Math.max(0, room);
  let overLimit = 0;

  const rows: PlannedRow[] = validations.map((v) => {
    const base = { row: v.row, input: v.input, errors: v.errors, warnings: v.warnings };
    if (!v.input) {
      counts.reject++;
      return { ...base, action: 'reject', reason: 'invalid' };
    }
    const key = fileKey(v.input);
    if (seen.has(key)) {
      counts.skip++;
      return { ...base, action: 'skip', reason: 'duplicate_in_file' };
    }
    seen.add(key);

    const productId = matchExisting(v.input, existing);
    if (productId) {
      counts.update++;
      return { ...base, action: 'update', productId };
    }
    // A manual product needs at least one image — the catalogue rule, and
    // what the AI pipeline works from. An update may leave the gallery alone;
    // a creation cannot start without one.
    if (v.input.images.length === 0) {
      counts.reject++;
      return {
        ...base,
        action: 'reject',
        reason: 'no_image',
        errors: [...v.errors, { code: 'no_image' }]
      };
    }
    if (left <= 0) {
      counts.skip++;
      overLimit++;
      return { ...base, action: 'skip', reason: 'plan_limit' };
    }
    left--;
    counts.create++;
    return { ...base, action: 'create' };
  });

  return { rows, counts, overLimit };
}
