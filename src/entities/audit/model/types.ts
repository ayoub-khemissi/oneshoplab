import type { NormalizedProduct, ProductImage, ProductVariant } from '@/entities/store-adapter';

/** Every defect the scorer can report. A runtime list (rather than a bare
 *  union) so the copy that explains each defect to the merchant —
 *  `FieldHelp.issue.<code>` in `messages/*.json` — can be asserted complete
 *  by `tests/unit/field-help.test.ts`. Appending a code without its
 *  explanation fails that test. */
export const ISSUE_CODES = [
  'no_image',
  'single_image',
  'no_description',
  'short_description',
  'unstructured_description',
  'short_title',
  'no_tags',
  'missing_alt_text',
  'low_resolution_image'
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export interface Issue {
  code: IssueCode;
  /** Optional payload — filled in for issues that need numeric context (e.g. alt text). */
  data?: Record<string, string | number>;
}

export interface ProductSignals {
  titleLength: number;
  descriptionTextLength: number;
  descriptionHasStructure: boolean;
  imageCount: number;
  imagesWithAlt: number;
  smallestImageWidth: number | null;
  variantCount: number;
  tagCount: number;
  tags: string[];
  vendor: string | null;
  productType: string | null;
  priceMin: number | null;
  priceMax: number | null;
  sourceUpdatedAt: Date | null;
}

export interface ProductInsight {
  sourceId: string | null;
  handle: string | null;
  title: string;
  url: string | null;
  /** Source HTML description, kept for AI rewriting. */
  descriptionHtml: string;
  /** Source images, kept for AI image-to-image generation. */
  images: ProductImage[];
  /** Source variants — useful when AI suggestions need size/colour context. */
  variants: ProductVariant[];
  /** 0..100 */
  score: number;
  issues: Issue[];
  signals: ProductSignals;
}

export interface CountedValue {
  value: string;
  count: number;
}

export interface AuditDistribution {
  imagesZero: number;
  imagesOne: number;
  imagesTwo: number;
  imagesThreePlus: number;
  descEmpty: number;
  descShortLt100: number;
  descMedium100To500: number;
  descLongGt500: number;
  descStructured: number;
  descPlainWall: number;
  tagsZero: number;
  tagsOneToThree: number;
  tagsFourToTen: number;
  tagsElevenPlus: number;
  altNone: number;
  altPartial: number;
  altFull: number;
}

export interface AuditScores {
  catalogCompleteness: number;
  copyQuality: number;
  visualQuality: number;
  taggingQuality: number;
  overall: number;
}

export interface AuditAverages {
  imageCount: number;
  descriptionLength: number;
  tagCount: number;
  variantCount: number;
  titleLength: number;
}

export interface AuditReport {
  sampled: number;
  avgProductScore: number;
  scores: AuditScores;
  averages: AuditAverages;
  lastProductUpdated: Date | null;
  lowResImageCount: number;
  distribution: AuditDistribution;
  topVendors: CountedValue[];
  topProductTypes: CountedValue[];
  topTags: CountedValue[];
  worstProducts: ProductInsight[];
  bestProducts: ProductInsight[];
  /** Full sorted list (worst-first) of every analysed product. Persisted on
   *  audit.summary so the dashboard can paginate the entire catalog. */
  allProducts: ProductInsight[];
  /**
   * The 3 most recently posted products — picked by sourceUpdatedAt desc when
   * dates are available, fallback to the last items in catalog order. These
   * are the ones we run AI generation on (per-product SEO rewrite, 3 lifestyle
   * images, 1 Instagram post).
   */
  latestProducts: ProductInsight[];
  /** Detected source language from a sample of product descriptions ('en', 'fr', ...). */
  detectedLanguage: string | null;
}

export type AuditInput = NormalizedProduct[];
