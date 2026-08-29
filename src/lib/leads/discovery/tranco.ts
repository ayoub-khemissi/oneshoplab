import { execSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { DiscoveryCandidate, SearchProvider } from '@/lib/leads/discovery/types';

// ---------------------------------------------------------------------------
// Tranco Top-1M — free, daily-refreshed list of the top 1M domains
// on the web ranked by a research-grade aggregate (Cisco Umbrella +
// Majestic + Alexa Internet replacement + Cloudflare Radar). Many
// merchants sit in the long tail; the qualifier handles platform
// detection on each candidate via the existing adapters.
//
// We cache the CSV in /tmp with a 7-day TTL — the list changes
// daily but the 7-day churn at the top end is negligible and the
// download is 10 MB.
// ---------------------------------------------------------------------------

const TRANCO_URL = 'https://tranco-list.eu/top-1m.csv.zip';
const TRANCO_CACHE_DIR = join(tmpdir(), 'oneshoplab-leads');
const TRANCO_CACHE_PATH = join(TRANCO_CACHE_DIR, 'tranco-top-1m.csv');
const TRANCO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function ensureTrancoCsv(): Promise<string> {
  mkdirSync(TRANCO_CACHE_DIR, { recursive: true });
  if (existsSync(TRANCO_CACHE_PATH)) {
    const age = Date.now() - statSync(TRANCO_CACHE_PATH).mtimeMs;
    if (age < TRANCO_TTL_MS) return TRANCO_CACHE_PATH;
  }
  const zipPath = join(TRANCO_CACHE_DIR, 'tranco.zip');
  const res = await fetch(TRANCO_URL, {
    signal: AbortSignal.timeout(60_000)
  });
  if (!res.ok) {
    throw new Error(`Tranco download HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(zipPath, buf);
  // System `unzip` is universally available on Linux; bringing in
  // adm-zip / unzipper would be a deps dance for a one-shot helper.
  execSync(`unzip -po ${zipPath} > ${TRANCO_CACHE_PATH}`, { stdio: 'ignore' });
  return TRANCO_CACHE_PATH;
}

export class TrancoProvider implements SearchProvider {
  /**
   * Walk a slice of the Tranco top-1M.
   *
   * @param startRank 1-indexed rank to begin at (default 5000).
   *                  Ranks 1-5000 are dominated by infrastructure,
   *                  CDNs, news, and big-platform domains — almost no
   *                  e-commerce merchants live there. Starting at 5k
   *                  drops the noise floor without losing yield.
   * @param endRank   1-indexed rank to stop at (inclusive). Cap at 1M.
   *
   * Each domain runs ~4 HTTP probes during detect(), so the
   * (endRank - startRank) span × concurrency directly drives runtime.
   */
  constructor(
    private readonly startRank: number = 5_000,
    private readonly endRank: number = 50_000
  ) {}

  async *discover({ limit }: { limit: number }): AsyncIterable<DiscoveryCandidate> {
    const path = await ensureTrancoCsv();
    const raw = await readFile(path, 'utf8');
    const lines = raw.split('\n');
    const from = Math.max(1, this.startRank) - 1; // CSV is 0-indexed
    const to = Math.min(this.endRank, lines.length);
    let yielded = 0;
    for (let i = from; i < to && yielded < limit; i++) {
      const line = lines[i];
      if (!line) continue;
      const comma = line.indexOf(',');
      if (comma < 0) continue;
      const domain = line.slice(comma + 1).trim();
      if (!domain) continue;
      yield {
        url: `https://${domain}`,
        source: `tranco:${this.startRank}-${this.endRank}`
      };
      yielded += 1;
    }
  }
}
