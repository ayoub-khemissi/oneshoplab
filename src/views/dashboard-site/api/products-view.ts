import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/shared/db';
import { jobs, type products } from '@/shared/db/schema';
import {
  PRODUCTS_PAGE_SIZE,
  type PaginatedProductPayload,
  type PaginatedProductWithId,
  type ProductsSortKey
} from '../model/types';

export type ProductRowLite = Pick<
  typeof products.$inferSelect,
  'id' | 'sourceId' | 'handle' | 'title' | 'sourceUrl' | 'status' | 'productType'
>;

export function buildProductIdByKey(productRows: ProductRowLite[]): Map<string, string> {
  const productIdByKey = new Map<string, string>();
  for (const p of productRows) {
    if (p.sourceId) productIdByKey.set(p.sourceId, p.id);
    if (p.handle) productIdByKey.set(p.handle, p.id);
  }
  return productIdByKey;
}

// Per-product AI activity. We aggregate completed kie_* jobs into
// (count, lastOptimAt) so the products list can:
//   - flag products with at least one finished generation via a badge,
//   - default-sort the list by most-recently optimized first.
// Excludes audit-runner kinds (kie_dynamic_audit, kie_prompt_suggest)
// which aren't user-visible "optims".
//
// Note on resolution: legacy chat/image insert paths never populated
// `jobs.productId` — they only stash the `productSourceId` inside the
// JSON `inputPayload`. Match on either so we count those rows too.
const PRODUCT_OPTIM_KINDS = [
  'kie_title',
  'kie_description',
  'kie_tags',
  'kie_alt_text',
  'kie_image_edit',
  'kie_image_generate'
] as const;

export type OptimRow = Pick<
  typeof jobs.$inferSelect,
  'productId' | 'inputPayload' | 'finishedAt' | 'kind'
>;

/** Completed user-visible generations for a project — see note above. */
export function loadOptimRows(projectId: string): Promise<OptimRow[]> {
  return db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.status, 'completed'),
      inArray(jobs.kind, [...PRODUCT_OPTIM_KINDS])
    ),
    columns: {
      productId: true,
      inputPayload: true,
      finishedAt: true,
      kind: true
    }
  });
}

export interface ProductsViewInput {
  activeTabIsProducts: boolean;
  summaryAllProducts: PaginatedProductPayload[];
  productRows: ProductRowLite[];
  optimRows: OptimRow[];
  productIdByKey: Map<string, string>;
  productsShowArchived: boolean;
  productsQuery: string;
  productsSort: ProductsSortKey;
  productsPage: number;
}

export interface ProductsView {
  productsSlice: PaginatedProductWithId[];
  safeProductsPage: number;
  productsTotalPages: number;
  productsTotalActive: number;
  productsTotalArchived: number;
  productsFilteredTotal: number;
  /** Map productId → title for the failure-detail modal so the merchant
   *  sees product names rather than UUIDs. */
  productTitleById: Record<string, string>;
}

export function buildProductsView({
  activeTabIsProducts,
  summaryAllProducts,
  productRows,
  optimRows,
  productIdByKey,
  productsShowArchived,
  productsQuery,
  productsSort,
  productsPage
}: ProductsViewInput): ProductsView {
  const optimByProductId = new Map<
    string,
    { lastOptimAt: Date | null; count: number; kinds: Set<string> }
  >();
  for (const r of optimRows) {
    const sourceId =
      r.inputPayload && typeof r.inputPayload === 'object' && 'productSourceId' in r.inputPayload
        ? ((r.inputPayload as { productSourceId?: string | null }).productSourceId ?? null)
        : null;
    const id = r.productId ?? (sourceId ? (productIdByKey.get(sourceId) ?? null) : null);
    if (!id) continue;
    const cur = optimByProductId.get(id) ?? {
      lastOptimAt: null,
      count: 0,
      kinds: new Set<string>()
    };
    cur.count += 1;
    cur.kinds.add(r.kind);
    if (r.finishedAt && (!cur.lastOptimAt || r.finishedAt > cur.lastOptimAt)) {
      cur.lastOptimAt = r.finishedAt;
    }
    optimByProductId.set(id, cur);
  }
  // A product is "AI completed" when title + description + tags are all
  // done AND at least one image has been generated (edit or generate).
  // alt_text is not required — it's an auto-add, not a user-driven optim.
  const isAiCompleted = (kinds: Set<string>): boolean =>
    kinds.has('kie_title') &&
    kinds.has('kie_description') &&
    kinds.has('kie_tags') &&
    (kinds.has('kie_image_edit') || kinds.has('kie_image_generate'));
  const archivedProductIds = new Set(
    productRows.filter((r) => r.status === 'archived').map((r) => r.id)
  );

  const allProductsWithIds: PaginatedProductWithId[] = activeTabIsProducts
    ? summaryAllProducts
        .map((p) => {
          const key = p.sourceId ?? p.handle ?? '';
          const productId = productIdByKey.get(key);
          if (!productId) return null;
          if (archivedProductIds.has(productId)) return null;
          const opt = optimByProductId.get(productId);
          // The summary stores the full ProductInsight, including
          // `signals.productType` — the TS type narrows it away,
          // but the runtime JSON still has it. Cast + extract so
          // the list chip is populated.
          const productType =
            (p as { signals?: { productType?: string | null } }).signals?.productType ?? null;
          return {
            ...p,
            productType,
            productId,
            archived: false,
            optimCount: opt?.count ?? 0,
            lastOptimAtIso: opt?.lastOptimAt ? opt.lastOptimAt.toISOString() : null,
            aiCompleted: opt ? isAiCompleted(opt.kinds) : false
          };
        })
        .filter((p): p is PaginatedProductWithId => p !== null)
    : [];

  // Archived products aren't in the latest summary (they fell out of the
  // scrape) — surface them under the "Show archived" toggle so the
  // merchant can still navigate to the optim page and recover their
  // custom instructions / generation history.
  const archivedProducts: PaginatedProductWithId[] = productRows
    .filter((r) => r.status === 'archived')
    .map((r) => {
      const opt = optimByProductId.get(r.id);
      return {
        sourceId: r.sourceId,
        handle: r.handle,
        title: r.title,
        url: r.sourceUrl,
        score: 0,
        issues: [],
        productType: r.productType,
        productId: r.id,
        archived: true,
        optimCount: opt?.count ?? 0,
        lastOptimAtIso: opt?.lastOptimAt ? opt.lastOptimAt.toISOString() : null,
        aiCompleted: opt ? isAiCompleted(opt.kinds) : false
      };
    });

  // Server-side filter + sort + paginate for the products tab. The
  // full catalog lives in summary.allProducts (already loaded into
  // memory), so we filter the in-memory array here instead of
  // shipping all rows to the client and doing the work there. This
  // keeps the URL the source of truth for current view and avoids
  // hydrating a multi-MB array on every search keystroke.
  const productsTotalActive = allProductsWithIds.length;
  const productsTotalArchived = archivedProducts.length;
  const productsCombined = productsShowArchived
    ? [...allProductsWithIds, ...archivedProducts]
    : allProductsWithIds;
  const productsFiltered = productsQuery
    ? productsCombined.filter((p) => p.title.toLowerCase().includes(productsQuery.toLowerCase()))
    : productsCombined;
  const productsSorted = [...productsFiltered].sort((a, b) => {
    // Archived sinks to the bottom regardless of the chosen sort —
    // they're a "secondary" set the merchant rarely cares about.
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    switch (productsSort) {
      case 'recently-optimized': {
        const aT = a.lastOptimAtIso ? new Date(a.lastOptimAtIso).getTime() : null;
        const bT = b.lastOptimAtIso ? new Date(b.lastOptimAtIso).getTime() : null;
        if (aT !== null && bT !== null) return bT - aT;
        if (aT !== null) return -1;
        if (bT !== null) return 1;
        return a.score - b.score;
      }
      case 'score-asc':
        return a.score - b.score;
      case 'score-desc':
        return b.score - a.score;
      case 'title-asc':
        return a.title.localeCompare(b.title);
      case 'title-desc':
        return b.title.localeCompare(a.title);
    }
  });
  const productsFilteredTotal = productsSorted.length;
  const productsTotalPages = Math.max(1, Math.ceil(productsFilteredTotal / PRODUCTS_PAGE_SIZE));
  const safeProductsPage = Math.min(productsPage, productsTotalPages);
  const productsSliceStart = (safeProductsPage - 1) * PRODUCTS_PAGE_SIZE;
  const productsSlice = productsSorted.slice(
    productsSliceStart,
    productsSliceStart + PRODUCTS_PAGE_SIZE
  );

  const productTitleById: Record<string, string> = {};
  for (const p of allProductsWithIds) {
    if (p.productId) productTitleById[p.productId] = p.title;
  }
  for (const p of archivedProducts) {
    if (p.productId) productTitleById[p.productId] = p.title;
  }

  return {
    productsSlice,
    safeProductsPage,
    productsTotalPages,
    productsTotalActive,
    productsTotalArchived,
    productsFilteredTotal,
    productTitleById
  };
}
