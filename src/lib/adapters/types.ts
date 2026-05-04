import type { Platform } from '@/lib/db/schema';

export interface ProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  position: number;
}

export interface ProductVariant {
  id: string;
  sourceVariantId: string | null;
  title: string | null;
  sku: string | null;
  /** In major units (e.g. 15.50 for €15.50). */
  price: number;
  available: boolean;
  options: Record<string, string>;
}

export interface NormalizedProduct {
  source: Platform;
  sourceId: string | null;
  sourceUrl: string | null;
  handle: string | null;
  title: string;
  descriptionHtml: string;
  images: ProductImage[];
  tags: string[];
  variants: ProductVariant[];
  vendor: string | null;
  productType: string | null;
  /** In major units. Null if no priced variants. */
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  sku: string | null;
  sourceUpdatedAt: Date | null;
}

export interface PlatformDetection {
  platform: Platform;
  /** 0..1. Above 0.7 is considered a confident match. */
  confidence: number;
  signals: string[];
}

export interface AdapterContext {
  url: string;
  /** Optional pre-fetched home HTML. Adapters may fetch it themselves if absent. */
  homeHtml?: string;
}

export interface FetchProgress {
  fetched: number;
  total: number | null;
  current: string;
}

export interface FetchOptions {
  maxProducts?: number;
  onProgress?: (p: FetchProgress) => void;
}

export interface PlatformAdapter {
  readonly name: Platform;

  /**
   * Inspect the URL + home HTML and return a confidence score that this
   * adapter can extract products from this site.
   */
  detect(ctx: AdapterContext): Promise<PlatformDetection>;

  /**
   * Stream normalized products from the source. The adapter handles pagination,
   * rate limiting, and error recovery internally.
   */
  fetchProducts(ctx: AdapterContext, options?: FetchOptions): AsyncIterable<NormalizedProduct>;
}
