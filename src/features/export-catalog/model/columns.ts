import type { ProductImage, ProductVariant } from '@/entities/store-adapter';

/**
 * The catalogue of exportable columns. Adding one here is all it takes: the
 * picker, the table and the CSV all read this list, and the query layer only
 * ever selects from it — a column key that is not in this catalogue cannot
 * reach the database or the file.
 */
export interface ExportRow {
  id: string;
  sourceId: string | null;
  handle: string | null;
  title: string;
  descriptionHtml: string | null;
  sourceUrl: string | null;
  vendor: string | null;
  productType: string | null;
  sku: string | null;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  tags: unknown;
  images: unknown;
  variants: unknown;
  status: string;
  sourceUpdatedAt: Date | null;
  updatedAt: Date | null;
}

export interface ExportColumn {
  key: string;
  /** Header written into the CSV — stable, English, machine-friendly. */
  header: string;
  /** Pulled from the row; must never throw on malformed JSON columns. */
  value: (row: ExportRow) => string;
  /** Shown as a table column on the page (the heavy ones are export-only). */
  inTable: boolean;
  /** Sortable server-side — only plain SQL columns qualify. */
  sortable: boolean;
}

function textOf(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function imagesOf(row: ExportRow): ProductImage[] {
  return Array.isArray(row.images) ? (row.images as ProductImage[]) : [];
}

function variantsOf(row: ExportRow): ProductVariant[] {
  return Array.isArray(row.variants) ? (row.variants as ProductVariant[]) : [];
}

/** Multi-value cells use " | " — a separator that survives a CSV round-trip. */
const JOIN = ' | ';

export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'title', header: 'title', inTable: true, sortable: true, value: (r) => r.title },
  {
    key: 'sku',
    header: 'sku',
    inTable: true,
    sortable: true,
    value: (r) => r.sku ?? ''
  },
  {
    key: 'vendor',
    header: 'vendor',
    inTable: true,
    sortable: true,
    value: (r) => r.vendor ?? ''
  },
  {
    key: 'productType',
    header: 'product_type',
    inTable: true,
    sortable: true,
    value: (r) => r.productType ?? ''
  },
  {
    key: 'price',
    header: 'price',
    inTable: true,
    sortable: true,
    value: (r) =>
      r.priceMin == null
        ? ''
        : r.priceMax && r.priceMax !== r.priceMin
          ? `${r.priceMin} - ${r.priceMax}`
          : r.priceMin
  },
  {
    key: 'currency',
    header: 'currency',
    inTable: false,
    sortable: false,
    value: (r) => r.currency ?? ''
  },
  {
    key: 'status',
    header: 'status',
    inTable: true,
    sortable: true,
    value: (r) => r.status
  },
  {
    key: 'tags',
    header: 'tags',
    inTable: false,
    sortable: false,
    value: (r) => (Array.isArray(r.tags) ? (r.tags as string[]).join(JOIN) : '')
  },
  {
    key: 'description',
    header: 'description',
    inTable: false,
    sortable: false,
    value: (r) => textOf(r.descriptionHtml)
  },
  {
    key: 'descriptionHtml',
    header: 'description_html',
    inTable: false,
    sortable: false,
    value: (r) => r.descriptionHtml ?? ''
  },
  {
    key: 'imageUrls',
    header: 'image_urls',
    inTable: false,
    sortable: false,
    // Links, never the bytes: the CSV stays small and the merchant keeps a
    // pointer to the image their store actually serves.
    value: (r) =>
      imagesOf(r)
        .map((i) => i?.src)
        .filter(Boolean)
        .join(JOIN)
  },
  {
    key: 'imageAlts',
    header: 'image_alts',
    inTable: false,
    sortable: false,
    value: (r) =>
      imagesOf(r)
        .map((i) => i?.alt ?? '')
        .join(JOIN)
  },
  {
    key: 'imageCount',
    header: 'image_count',
    inTable: true,
    sortable: false,
    value: (r) => String(imagesOf(r).length)
  },
  {
    key: 'variantCount',
    header: 'variant_count',
    inTable: false,
    sortable: false,
    value: (r) => String(variantsOf(r).length)
  },
  {
    key: 'variantSkus',
    header: 'variant_skus',
    inTable: false,
    sortable: false,
    value: (r) =>
      variantsOf(r)
        .map((v) => v?.sku ?? '')
        .filter(Boolean)
        .join(JOIN)
  },
  {
    key: 'handle',
    header: 'handle',
    inTable: false,
    sortable: false,
    value: (r) => r.handle ?? ''
  },
  {
    key: 'sourceId',
    header: 'source_id',
    inTable: false,
    sortable: false,
    value: (r) => r.sourceId ?? ''
  },
  {
    key: 'sourceUrl',
    header: 'source_url',
    inTable: false,
    sortable: false,
    value: (r) => r.sourceUrl ?? ''
  },
  {
    key: 'sourceUpdatedAt',
    header: 'source_updated_at',
    inTable: false,
    sortable: true,
    value: (r) => (r.sourceUpdatedAt ? r.sourceUpdatedAt.toISOString() : '')
  },
  {
    key: 'updatedAt',
    header: 'updated_at',
    inTable: true,
    sortable: true,
    value: (r) => (r.updatedAt ? r.updatedAt.toISOString() : '')
  }
];

export const COLUMN_BY_KEY = new Map(EXPORT_COLUMNS.map((c) => [c.key, c]));

/** What a merchant gets before touching anything. */
export const DEFAULT_COLUMN_KEYS: readonly string[] = [
  'title',
  'sku',
  'price',
  'currency',
  'description',
  'imageUrls',
  'tags',
  'sourceUrl'
];
