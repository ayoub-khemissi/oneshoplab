import type { Platform } from '@/shared/db/schema';
import { fetchText, rootOf } from '../lib/fetch-utils';
import { manualAdapter } from './manual';
import { shopifyAdapter } from './shopify';
import { wixAdapter } from './wix';
import { woocommerceAdapter } from './woocommerce';
import type { AdapterContext, PlatformAdapter, PlatformDetection } from '../model/types';

export const ADAPTERS: PlatformAdapter[] = [
  shopifyAdapter,
  woocommerceAdapter,
  wixAdapter,
  manualAdapter
];

export const ADAPTERS_BY_NAME: Record<Platform, PlatformAdapter> = {
  shopify: shopifyAdapter,
  woocommerce: woocommerceAdapter,
  wix: wixAdapter,
  manual: manualAdapter,
  unknown: manualAdapter
};

export const CONFIDENCE_THRESHOLD = 0.7;

export interface DetectionResult {
  url: string;
  finalUrl: string;
  homeHtml: string;
  detection: PlatformDetection;
  candidates: PlatformDetection[];
  adapter: PlatformAdapter | null;
}

/**
 * Detect the platform powering a given URL by fetching the home page once
 * and asking each adapter (except manual) for a confidence score in parallel.
 * Returns the adapter to use plus the home HTML so the caller can pass it
 * to fetchProducts without a second round-trip.
 */
export async function detectPlatform(url: string): Promise<DetectionResult> {
  const root = rootOf(url);
  const home = await fetchText(root);
  const ctx: AdapterContext = { url: root, homeHtml: home.body };

  const candidates = await Promise.all(
    ADAPTERS.filter((a) => a.name !== 'manual').map((a) => a.detect(ctx))
  );
  candidates.sort((a, b) => b.confidence - a.confidence);

  const best = candidates[0];
  const passes = best && best.confidence >= CONFIDENCE_THRESHOLD;

  const detection: PlatformDetection = passes
    ? best
    : { platform: 'unknown', confidence: best?.confidence ?? 0, signals: best?.signals ?? [] };

  const adapter = passes ? ADAPTERS_BY_NAME[best.platform] : null;

  return {
    url,
    finalUrl: home.finalUrl || root,
    homeHtml: home.body,
    detection,
    candidates,
    adapter
  };
}
