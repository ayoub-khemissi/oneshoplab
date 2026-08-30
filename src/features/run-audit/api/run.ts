import { detectPlatform, type NormalizedProduct } from '@/entities/store-adapter';
import type { Platform } from '@/lib/db/schema';
import { audit, type AuditReport } from '@/entities/audit';

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
}

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
      error: 'Could not detect a supported e-commerce platform on this URL.'
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
    error: fetchError
  };
}
