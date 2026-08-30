import type { SearchProvider } from '../model/types';
import { SeedListProvider } from './seed';
import { BraveSearchProvider } from './brave';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  kind: 'seed' | 'brave';
  /** Path to a text file for `seed`; query string for `brave`. */
  input: string;
  /** Brave-only: bias results to a market (`fr`, `us`, …). */
  country?: string;
}

export function buildProvider(cfg: ProviderConfig): SearchProvider {
  if (cfg.kind === 'seed') return new SeedListProvider(cfg.input);
  const key = process.env.BRAVE_API_KEY;
  if (!key) {
    throw new Error(
      'BRAVE_API_KEY is not set — register at https://api-dashboard.search.brave.com/ ' +
        'and add the key to .env to use the brave provider.'
    );
  }
  return new BraveSearchProvider(cfg.input, key, cfg.country);
}
