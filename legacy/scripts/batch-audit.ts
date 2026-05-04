import { spawn } from 'node:child_process';

const STORES = [
  'https://asphalte.com/',
  'https://www.balzac-paris.fr/',
  'https://www.cabaia.fr/',
  'https://www.respire.co/',
  'https://www.ohmycream.com/',
  'https://www.pandatea.fr/',
  'https://www.caravane.fr/',
  'https://flowrette.com/',
  'https://tajinebanane.fr/',
  'https://www.morphee.co/',
  'https://www.jimmyfairly.com/',
  'https://rhinoshield.fr/'
];
const CONCURRENCY = 4;

interface AuditResult {
  url: string;
  ok: boolean;
  data?: any;
  err?: string;
  duration_s: number;
}

async function runOne(url: string): Promise<AuditResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const p = spawn('node_modules\\.bin\\tsx.cmd', ['src/audit.ts', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('close', (code) => {
      const duration_s = (Date.now() - start) / 1000;
      if (code !== 0) {
        resolve({ url, ok: false, err: (err.trim() || `exit ${code}`).slice(0, 200), duration_s });
        return;
      }
      const startMarker = '=== REPORT (JSON) ===\n';
      const endMarker = '\n\n=== SCORES ===';
      const s = out.indexOf(startMarker);
      const e = out.indexOf(endMarker);
      if (s < 0 || e < 0) {
        resolve({ url, ok: false, err: 'parse failed', duration_s });
        return;
      }
      try {
        const data = JSON.parse(out.slice(s + startMarker.length, e));
        resolve({ url, ok: true, data, duration_s });
      } catch (jsonErr) {
        resolve({ url, ok: false, err: `json: ${(jsonErr as Error).message}`, duration_s });
      }
    });
    p.on('error', (e) => {
      resolve({ url, ok: false, err: e.message, duration_s: (Date.now() - start) / 1000 });
    });
  });
}

async function pool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx]);
      }
    })
  );
  return results;
}

function pad(s: string, n: number) { return s.length > n ? s.slice(0, n) : s.padEnd(n); }
function padR(s: string, n: number) { return s.padStart(n); }

async function main() {
  console.log(`Running audit on ${STORES.length} stores (concurrency=${CONCURRENCY})...\n`);
  const results = await pool(STORES, CONCURRENCY, async (url) => {
    process.stdout.write(`  starting ${url}\n`);
    const r = await runOne(url);
    if (r.ok) {
      const d = r.data;
      console.log(`  ok ${url} (${r.duration_s.toFixed(1)}s) -- ${d.catalog.sampled} prods, score ${d.scores.overall}`);
    } else {
      console.log(`  ko ${url} (${r.duration_s.toFixed(1)}s) -- ${r.err}`);
    }
    return r;
  });

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log(`\n=== SUMMARY: ${ok.length} OK / ${failed.length} failed ===\n`);

  if (failed.length > 0) {
    console.log('Failed:');
    for (const r of failed) console.log(`  - ${r.url}: ${r.err}`);
    console.log();
  }

  if (ok.length === 0) return;

  console.log('Per-store summary:');
  console.log(
    `${pad('Domain', 38)} | ${pad('Prods', 5)} | ${pad('Curr', 4)} | ${pad('Loc', 5)} | ${pad('Score', 5)} | ${pad('AvgImg', 6)} | ${pad('NoImg%', 6)} | ${pad('NoDesc%', 7)} | ${pad('NoTag%', 6)} | ${pad('FullAlt%', 8)}`
  );
  console.log('-'.repeat(115));
  for (const r of ok) {
    const d = r.data;
    const n = d.catalog.sampled || 1;
    const pct = (x: number) => `${Math.round((x / n) * 100)}%`;
    console.log(
      `${pad(d.domain, 38)} | ${padR(String(d.catalog.sampled), 5)} | ${pad(d.store_meta.currency ?? '?', 4)} | ${pad(d.store_meta.locale ?? '?', 5)} | ${padR(String(d.scores.overall), 5)} | ${padR(String(d.catalog.avg_image_count), 6)} | ${padR(pct(d.catalog.distribution.images_0), 6)} | ${padR(pct(d.catalog.distribution.desc_empty), 7)} | ${padR(pct(d.catalog.distribution.tags_0), 6)} | ${padR(pct(d.catalog.distribution.full_alt_text), 8)}`
    );
  }

  console.log('\nCross-store field availability:');
  const total = ok.length;
  const withCurr = ok.filter((r) => r.data.store_meta.currency).length;
  const withLoc = ok.filter((r) => r.data.store_meta.locale).length;

  const avg = (fn: (r: AuditResult) => number) => ok.reduce((s, r) => s + fn(r), 0) / total;
  const meanWithImage = avg((r) => 1 - r.data.catalog.distribution.images_0 / (r.data.catalog.sampled || 1)) * 100;
  const meanWithDesc = avg((r) => 1 - r.data.catalog.distribution.desc_empty / (r.data.catalog.sampled || 1)) * 100;
  const meanWithTag = avg((r) => 1 - r.data.catalog.distribution.tags_0 / (r.data.catalog.sampled || 1)) * 100;
  const meanFullAlt = avg((r) => r.data.catalog.distribution.full_alt_text / (r.data.catalog.sampled || 1)) * 100;
  const meanScore = avg((r) => r.data.scores.overall);
  const meanCopy = avg((r) => r.data.scores.copy_quality);
  const meanVisual = avg((r) => r.data.scores.visual_quality);

  console.log(`  /products.json reachable                ${ok.length}/${results.length} stores`);
  console.log(`  Currency detected (/cart.js)            ${withCurr}/${total} (${Math.round((withCurr / total) * 100)}%)`);
  console.log(`  Locale detected (HTML lang)             ${withLoc}/${total} (${Math.round((withLoc / total) * 100)}%)`);
  console.log(`  Avg % products with at least 1 image    ${meanWithImage.toFixed(1)}%`);
  console.log(`  Avg % products with description         ${meanWithDesc.toFixed(1)}%`);
  console.log(`  Avg % products with at least 1 tag      ${meanWithTag.toFixed(1)}%`);
  console.log(`  Avg % products with full alt text       ${meanFullAlt.toFixed(1)}%`);
  console.log(`  Mean overall score                      ${meanScore.toFixed(1)}/100`);
  console.log(`  Mean copy quality                       ${meanCopy.toFixed(1)}/100`);
  console.log(`  Mean visual quality                     ${meanVisual.toFixed(1)}/100`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
