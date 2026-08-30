export interface ShareLinkRow {
  id: string;
  label: string | null;
  showOnHome: boolean;
  /** Admin-curated position in the home showcase. NULL = unranked. */
  homeOrder?: number | null;
  createdAt: Date | string;
  productSourceIds: string[];
}

export interface CandidateProduct {
  sourceId: string;
  title: string;
  hasTitle: boolean;
  hasDescription: boolean;
  hasTags: boolean;
  hasImages: boolean;
}

/** Minimal "source" product snapshot the showcase + shared-audit
 *  pages render. Either pulled from the audit summary or, when the
 *  upstream store rotated its product id and the summary no longer
 *  carries that sourceId, recovered from the persistent `products`
 *  table (whose sourceId stays stable across re-scrapes — see
 *  sync-products.ts). The AI side keys off the stored sourceId via
 *  the jobs table, which never rotates, so it keeps resolving even
 *  when the catalog id changed. */
export interface FeaturedProductSnapshot {
  title: string;
  url?: string | null;
  descriptionHtml?: string;
  images?: Array<{ src: string; alt?: string | null }>;
  signals?: { tags?: string[] };
}

export interface HomeShowcaseCard {
  /** Token used in the /share/[token] URL the prospect clicks. */
  token: string;
  domain: string;
  siteUrl: string;
  /** Detected e-commerce platform of the site, when known. Drives the
   *  brand badge in the showcase header (Shopify / WooCommerce / Wix).
   *  Null = `manual` audit or unrecognised platform — no badge shown. */
  platform: 'shopify' | 'woocommerce' | 'wix' | null;
  /** Both products from the share link with full before/after data:
   *  source + AI title, description, tags, plus image arrays for the
   *  carousel-style browsing on the home strip. */
  products: Array<{
    sourceId: string;
    sourceTitle: string;
    /** Direct product URL on the merchant's storefront (when the audit
     *  summary captured one). Drives the clickable title link in the
     *  home card; falls back to siteUrl when missing. */
    productUrl: string | null;
    aiTitle: string | null;
    sourceDescriptionHtml: string;
    aiDescriptionHtml: string | null;
    sourceTags: string[];
    aiTags: string[];
    sourceImages: Array<{ src: string; alt: string | null }>;
    aiImages: Array<{ src: string; alt: string | null }>;
  }>;
}

export interface SharedProduct {
  sourceId: string;
  /** From the audit summary at the time of viewing — never the raw
   *  productRow stripped, so we get prices, vendor, etc. */
  title: string;
  source: {
    descriptionHtml: string;
    tags: string[];
    images: { src: string; alt: string | null }[];
  };
  ai: {
    title: string | null;
    descriptionHtml: string | null;
    tags: string[];
    imageUrls: string[];
  };
}

export interface SharedAuditSnapshot {
  /** Site domain shown in the case-study header. */
  domain: string;
  /** Full URL of the merchant's storefront — used to make the header
   *  domain clickable. Falls back to https://{domain} when the
   *  project / audit didn't capture an explicit URL. */
  siteUrl: string;
  platform: string | null;
  scores: {
    catalogCompleteness: number;
    copyQuality: number;
    visualQuality: number;
    taggingQuality: number;
    overall: number;
  } | null;
  /** Optional summary insights surfaced inside the scores card via a
   *  collapsible "See full audit detail" toggle. All fields are
   *  resilient to missing data on legacy audits — `null` means the
   *  audit predates that summary field and the toggle hides the row. */
  details: {
    sampled: number | null;
    avgProductScore: number | null;
    averages: {
      imageCount: number | null;
      descriptionLength: number | null;
      tagCount: number | null;
    };
    distribution: {
      imagesZero: number | null;
      descEmpty: number | null;
      tagsZero: number | null;
      altNone: number | null;
    };
    /** Up to 6 worst-scoring products with their issue codes — used to
     *  illustrate what the audit found without exposing the full list
     *  on a public page. */
    worstProducts: Array<{
      title: string;
      score: number;
      issues: Array<{ code: string; data?: Record<string, string | number> }>;
    }>;
  } | null;
  products: SharedProduct[];
  /** When the share link was created — surfaced as "Generated on {date}". */
  generatedAt: Date;
  label: string | null;
}
