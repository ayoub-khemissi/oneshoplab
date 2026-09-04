import { detectPlatform, type NormalizedProduct } from '@/entities/store-adapter';
import type { Platform } from '@/shared/db/schema';
import { audit, type AuditReport } from '@/entities/audit';
import type { AuditDataSource, AuditSourceReason } from '../lib/source-decision';

/** Freshness of the stored catalog a connection-sourced audit scored. */
export interface CatalogFreshness {
  syncedAt: Date | null;
  stale: boolean;
  /** A refresh was asked of the connector before scoring. */
  refreshRequested: boolean;
}

export interface RunAuditResult {
  url: string;
  finalUrl: string;
  platform: Platform;
  detectionConfidence: number;
  detectionSignals: string[];
  productsFetched: number;
  truncated: boolean;
  /** Raw normalized products — exposed so the persistence layer can mirror
   *  them into the `products` table for stable per-product URLs. */
  products: NormalizedProduct[];
  report: AuditReport | null;
  error: string | null;
  /** 'connection' = scored from the catalog the integration owns; those
   *  products must never be written back (see `runAuditForProject`). */
  source: AuditDataSource;
  sourceReason: AuditSourceReason;
  /** Null on the storefront path. */
  catalog: CatalogFreshness | null;
}

/** `runAudit` only ever scrapes; `runAuditForProject` overwrites the reason
 *  when it fell back here from a connected project. */
const STOREFRONT_SOURCE = {
  source: 'storefront',
  sourceReason: 'no_connection',
  catalog: null
} as const;

/**
 * Full audit pipeline: detect platform from URL → fetch products via the
 * matching adapter → compute the audit report. Returns a structured result
 * even on partial failures (best-effort report from products fetched so far).
 */
export async function runAudit(
  url: string,
  options?: {
    maxProducts?: number;
    onProgress?: (fetched: number) => void;
  }
): Promise<RunAuditResult> {
  // Default cap of 10k covers the long tail of small/mid e-commerce stores
  // (Shopify Plus merchants rarely exceed 5k SKUs). Beyond that the JSON
  // summary blob would get unwieldy — large catalogs can pass a custom cap.
  const max = options?.maxProducts ?? 10000;
  const detection = await detectPlatform(url);

  if (!detection.adapter) {
    return {
      url,
      finalUrl: detection.finalUrl,
      platform: 'unknown',
      detectionConfidence: detection.detection.confidence,
      detectionSignals: detection.detection.signals,
      productsFetched: 0,
      truncated: false,
      products: [],
      report: null,
      // A code, not a sentence: the UI translates it. It used to be stored as
      // English prose and rendered verbatim inside a translated frame.
      error: 'platform_not_detected',
      ...STOREFRONT_SOURCE
    };
  }

  const products: NormalizedProduct[] = [];
  let fetchError: string | null = null;
  try {
    for await (const p of detection.adapter.fetchProducts(
      { url, homeHtml: detection.homeHtml },
      { maxProducts: max }
    )) {
      products.push(p);
      if (options?.onProgress) options.onProgress(products.length);
    }
  } catch (e) {
    fetchError = (e as Error).message;
  }

  return {
    url,
    finalUrl: detection.finalUrl,
    platform: detection.adapter.name,
    detectionConfidence: detection.detection.confidence,
    detectionSignals: detection.detection.signals,
    productsFetched: products.length,
    truncated: products.length === max,
    products,
    report: products.length > 0 ? audit(products) : null,
    error: fetchError,
    ...STOREFRONT_SOURCE
  };
}
