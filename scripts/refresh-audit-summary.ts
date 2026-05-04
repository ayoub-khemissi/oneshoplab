/**
 * Re-run the STATIC analysis of an existing audit (catalog scrape + scoring)
 * and refresh the audit's `summary` JSON with the freshly-computed report —
 * including the new `allProducts` field that older audits don't have.
 *
 * No dynamic AI generation is re-run; existing kie_dynamic_audit /
 * kie_image_edit jobs stay untouched. Free of charge.
 *
 * Run with:
 *   pnpm tsx scripts/refresh-audit-summary.ts <domain>
 *
 * Example:
 *   pnpm tsx scripts/refresh-audit-summary.ts www.hdoeuvre.com
 */
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  const [, , domainArg] = process.argv;
  if (!domainArg) {
    console.error('Usage: pnpm tsx scripts/refresh-audit-summary.ts <domain>');
    process.exit(1);
  }
  const domain = domainArg.trim();

  const { desc, eq } = await import('drizzle-orm');
  const { db } = await import('../src/lib/db/index');
  const { audits } = await import('../src/lib/db/schema');
  const { runAudit } = await import('../src/lib/audit/run');

  const audit = await db.query.audits.findFirst({
    where: eq(audits.domain, domain),
    orderBy: [desc(audits.createdAt)]
  });
  if (!audit) {
    console.error(`No audit found for domain ${domain}`);
    process.exit(1);
  }
  console.log(`Audit: ${audit.id} (${audit.url})`);

  console.log('Re-running static analysis (this may take ~30s)…');
  const result = await runAudit(audit.url, { maxProducts: 10000 });
  if (!result.report) {
    console.error('runAudit returned no report:', result.error);
    process.exit(1);
  }
  const r = result.report;
  console.log(`  ✓ ${r.sampled} products analysed`);
  console.log(`  ✓ ${r.allProducts.length} entries in allProducts`);

  // Merge: keep existing fields we don't recompute, update the static ones.
  const existingSummary = (audit.summary ?? {}) as Record<string, unknown>;
  const newSummary = {
    ...existingSummary,
    avgProductScore: r.avgProductScore,
    averages: r.averages,
    lastProductUpdated: r.lastProductUpdated,
    lowResImageCount: r.lowResImageCount,
    distribution: r.distribution,
    topVendors: r.topVendors,
    topProductTypes: r.topProductTypes,
    topTags: r.topTags,
    worstProducts: r.worstProducts,
    bestProducts: r.bestProducts,
    latestProducts: r.latestProducts,
    allProducts: r.allProducts,
    detectedLanguage: r.detectedLanguage
  };

  await db
    .update(audits)
    .set({
      scores: r.scores,
      summary: newSummary,
      productsSampled: result.productsFetched
    })
    .where(eq(audits.id, audit.id));

  console.log(`\nDone. Audit ${audit.id} refreshed.`);
  console.log(`Reload /dashboard to see the full product list.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
