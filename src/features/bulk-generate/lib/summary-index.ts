import type { SummaryProduct, SummaryShape } from './context';

/**
 * Lookup tables over an audit summary's product lists, built once per audit
 * version instead of spreading every list on every worker pass.
 *
 * Gives the same answer as the scan it replaces:
 *
 *   [...allProducts, ...worstProducts, ...latestProducts, ...bestProducts].find(
 *     (p) => (row.sourceId && p.sourceId === row.sourceId) ||
 *            (row.handle && p.handle === row.handle))
 *
 * i.e. the FIRST product in that order matching EITHER key — not "any
 * sourceId match before any handle match". Each map keeps the first position
 * its key appears at, and the lookup returns whichever hit comes first.
 */
interface Hit {
  position: number;
  product: SummaryProduct;
}

export interface SummaryIndex {
  bySourceId: Map<string, Hit>;
  byHandle: Map<string, Hit>;
}

const LISTS = ['allProducts', 'worstProducts', 'latestProducts', 'bestProducts'] as const;

export function buildSummaryIndex(summary: SummaryShape | null): SummaryIndex {
  const index: SummaryIndex = { bySourceId: new Map(), byHandle: new Map() };
  if (!summary) return index;
  let position = 0;
  for (const list of LISTS) {
    for (const product of summary[list] ?? []) {
      const hit = { position, product };
      position += 1;
      // A malformed entry can never match; the old scan threw on it instead.
      if (!product) continue;
      // Falsy keys are never looked up (the row's key must be truthy).
      if (product.sourceId && !index.bySourceId.has(product.sourceId)) {
        index.bySourceId.set(product.sourceId, hit);
      }
      if (product.handle && !index.byHandle.has(product.handle)) {
        index.byHandle.set(product.handle, hit);
      }
    }
  }
  return index;
}

export function matchSummaryProduct(
  index: SummaryIndex,
  row: { sourceId: string | null; handle: string | null }
): SummaryProduct | null {
  const bySourceId = row.sourceId ? index.bySourceId.get(row.sourceId) : undefined;
  const byHandle = row.handle ? index.byHandle.get(row.handle) : undefined;
  if (bySourceId && byHandle) {
    return bySourceId.position <= byHandle.position ? bySourceId.product : byHandle.product;
  }
  return (bySourceId ?? byHandle)?.product ?? null;
}
