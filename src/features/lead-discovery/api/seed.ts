import { readFile } from 'node:fs/promises';

import type { DiscoveryCandidate, SearchProvider } from '../model/types';

// ---------------------------------------------------------------------------
// Seed list — read URLs from a file
// ---------------------------------------------------------------------------

export class SeedListProvider implements SearchProvider {
  constructor(private readonly filePath: string) {}

  async *discover({ limit }: { limit: number }): AsyncIterable<DiscoveryCandidate> {
    const raw = await readFile(this.filePath, 'utf8');
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    let yielded = 0;
    for (const url of lines) {
      if (yielded >= limit) return;
      yield { url, source: `seed:${this.filePath}` };
      yielded += 1;
    }
  }
}
