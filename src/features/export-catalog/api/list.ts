import { and, asc, count, desc, eq, like, ne, or, type SQL } from 'drizzle-orm';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
import type { ExportQuery } from '../lib/query';
import { MAX_EXPORT_ROWS, PAGE_SIZE } from '../lib/query';
import type { ExportRow } from '../model/columns';

/**
 * Columns a merchant may sort by, mapped to real SQL columns. The query
 * parser already refuses anything outside this set; keeping the mapping here
 * means an unknown key cannot become a column reference even by mistake.
 */
const SORT_COLUMNS = {
  title: products.title,
  sku: products.sku,
  vendor: products.vendor,
  productType: products.productType,
  price: products.priceMin,
  status: products.status,
  sourceUpdatedAt: products.sourceUpdatedAt,
  updatedAt: products.updatedAt
} as const;

/** `%` and `_` are wildcards in LIKE: a merchant typing them means the characters. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereFor(projectId: string, query: ExportQuery): SQL | undefined {
  const term = query.q ? `%${escapeLike(query.q)}%` : null;
  return and(
    eq(products.projectId, projectId),
    query.status === 'all'
      ? undefined
      : query.status === 'archived'
        ? eq(products.status, 'archived')
        : ne(products.status, 'archived'),
    term
      ? or(like(products.title, term), like(products.sku, term), like(products.vendor, term))
      : undefined
  );
}

function orderFor(query: ExportQuery) {
  const col = SORT_COLUMNS[query.sort as keyof typeof SORT_COLUMNS] ?? products.updatedAt;
  const direction = query.dir === 'asc' ? asc : desc;
  // Tie-break on the primary key: without it, two products with the same
  // title can swap places between pages and the merchant sees a duplicate
  // on one page and a hole on the next.
  return [direction(col), asc(products.id)];
}

/** Everything the table needs, plus what any selected column might read. */
const ROW_COLUMNS = {
  id: products.id,
  sourceId: products.sourceId,
  handle: products.handle,
  title: products.title,
  descriptionHtml: products.descriptionHtml,
  sourceUrl: products.sourceUrl,
  vendor: products.vendor,
  productType: products.productType,
  sku: products.sku,
  priceMin: products.priceMin,
  priceMax: products.priceMax,
  currency: products.currency,
  tags: products.tags,
  images: products.images,
  variants: products.variants,
  status: products.status,
  sourceUpdatedAt: products.sourceUpdatedAt,
  updatedAt: products.updatedAt
} as const;

export interface ExportPage {
  rows: ExportRow[];
  total: number;
  pageCount: number;
  page: number;
}

/** One page of the browsable table. */
export async function loadExportPage(projectId: string, query: ExportQuery): Promise<ExportPage> {
  const where = whereFor(projectId, query);
  const [{ value: total } = { value: 0 }] = await db
    .select({ value: count() })
    .from(products)
    .where(where);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  const rows = (await db
    .select(ROW_COLUMNS)
    .from(products)
    .where(where)
    .orderBy(...orderFor(query))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)) as ExportRow[];

  return { rows, total, pageCount, page };
}

/**
 * Every row matching the current filters, for the file. Capped: an export is
 * built in memory and streamed as one response, so the ceiling is what keeps
 * a 100k-product catalogue from turning into a 500 MB string.
 */
export async function loadExportRows(
  projectId: string,
  query: ExportQuery,
  limit: number = MAX_EXPORT_ROWS
): Promise<ExportRow[]> {
  return (await db
    .select(ROW_COLUMNS)
    .from(products)
    .where(whereFor(projectId, query))
    .orderBy(...orderFor(query))
    .limit(limit)) as ExportRow[];
}

/** A single product, for the per-product export button. */
export async function loadExportRow(
  projectId: string,
  productId: string
): Promise<ExportRow | null> {
  const [row] = (await db
    .select(ROW_COLUMNS)
    .from(products)
    .where(and(eq(products.projectId, projectId), eq(products.id, productId)))
    .limit(1)) as ExportRow[];
  return row ?? null;
}
