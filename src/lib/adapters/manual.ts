import type { AdapterContext, NormalizedProduct, PlatformAdapter, PlatformDetection } from './types';

/**
 * Greenfield adapter — for users without an existing storefront.
 * Never auto-detects from a URL. Products are created manually or via AI
 * generation through the dashboard, not fetched from a remote source.
 */
export const manualAdapter: PlatformAdapter = {
  name: 'manual',

  async detect(): Promise<PlatformDetection> {
    return { platform: 'manual', confidence: 0, signals: [] };
  },

  async *fetchProducts(_ctx: AdapterContext): AsyncIterable<NormalizedProduct> {
    // Greenfield projects have no remote source — products live in our DB only.
    return;
  }
};
