import type { jobs } from '@/shared/db/schema';

export type Tab = 'overview' | 'products' | 'jobs' | 'integrations' | 'settings';

export const ACTIVITY_PAGE_SIZE = 15;
export const PRODUCTS_PAGE_SIZE = 15;
export const PRODUCTS_SORT_KEYS = [
  'recently-optimized',
  'score-asc',
  'score-desc',
  'title-asc',
  'title-desc'
] as const;
export type ProductsSortKey = (typeof PRODUCTS_SORT_KEYS)[number];

export interface Scores {
  catalogCompleteness: number;
  copyQuality: number;
  visualQuality: number;
  taggingQuality: number;
  overall: number;
}

export interface ProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductInsightLite {
  sourceId: string | null;
  handle: string | null;
  title: string;
  url: string | null;
  descriptionHtml: string;
  images: ProductImage[];
  score: number;
  signals?: { tags?: string[]; productType?: string | null };
}

export interface IssuePayload {
  code: string;
  data?: Record<string, string | number>;
}

export interface PaginatedProductPayload {
  sourceId: string | null;
  handle: string | null;
  title: string;
  url: string | null;
  score: number;
  issues: IssuePayload[];
  /** Category chip in the list — Shopify product_type, first WC/Wix
   *  category, or whatever the user entered for a manual product.
   *  Required (nullable) at this layer so the type predicate below
   *  narrows cleanly; the runtime value is filled from
   *  `signals.productType` for summary entries and from the row for
   *  archived entries. */
  productType: string | null;
}

export interface PaginatedProductWithId extends PaginatedProductPayload {
  productId: string;
  /** Soft-archived: present on a previous scrape but missing from the
   *  latest one. Surface under a toggle, disable any "Generate" CTAs. */
  archived: boolean;
  /** Number of completed kie_* generations for this product. Drives the
   *  "AI started" badge in the list. Zero = no AI work yet. */
  optimCount: number;
  /** ISO timestamp of the most recent completed kie_* generation. Drives
   *  the default "recently optimized" sort. Null = never optimized. */
  lastOptimAtIso: string | null;
  /** True when title + description + tags + at least one image have all
   *  been generated. Drives the green "AI completed" badge. Takes
   *  precedence over the "started" badge when both apply. */
  aiCompleted: boolean;
}

export interface SummaryShape {
  avgProductScore?: number;
  averages?: {
    imageCount?: number;
    descriptionLength?: number;
    tagCount?: number;
    titleLength?: number;
  };
  distribution?: {
    altNone?: number;
    altPartial?: number;
    altFull?: number;
    imagesZero?: number;
    descEmpty?: number;
    descShortLt100?: number;
  };
  latestProducts?: ProductInsightLite[];
  worstProducts?: ProductInsightLite[];
  allProducts?: PaginatedProductPayload[];
  detectedLanguage?: string | null;
}

export type ProjectJobRow = typeof jobs.$inferSelect & {
  product: {
    id: string;
    sourceId: string | null;
    handle: string | null;
    title: string;
    status: 'active' | 'archived';
  } | null;
};
