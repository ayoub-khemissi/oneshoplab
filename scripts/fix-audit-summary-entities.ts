/**
 * One-shot data fix: decode HTML entities in cached audit summaries
 * AND the products table. Older audits captured product titles BEFORE
 * the decoder in src/lib/adapters/fetch-utils.ts covered numeric refs
 * (&#8211;, &#8217;, &#xNNNN;), so the JSON we render from still holds
 * the raw entities. WordPress's wptexturize is the usual offender on
 * WooCommerce catalogs (Lacafetiere, Dammann, …).
 *
 * Usage:
 *
 *   # Dry-run — print a sample of what would change, no writes.
 *   pnpm tsx scripts/fix-audit-summary-entities.ts --dry-run
 *
 *   # Apply — update audits.summary + products.title rows in place.
 *   pnpm tsx scripts/fix-audit-summary-entities.ts --apply
 *
 * Idempotent: running again on already-decoded data is a no-op (a
 * title without entities decodes to itself).
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

interface CliArgs {
  apply: boolean;
  sampleSize: number;
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false;
  let sampleSize = 5;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') apply = false;
    else if (a === '--sample-size' && argv[i + 1]) {
      sampleSize = Math.max(1, Math.min(50, Number(argv[i + 1])));
      i++;
    }
  }
  return { apply, sampleSize };
}

interface SummaryProduct {
  title?: string;
  signals?: { productType?: string | null };
  [k: string]: unknown;
}

interface AuditSummary {
  worstProducts?: SummaryProduct[];
  allProducts?: SummaryProduct[];
  [k: string]: unknown;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const { decodeHtmlEntities } = await import('@/lib/adapters/fetch-utils');
  const { db } = await import('@/lib/db');
  const { audits, products } = await import('@/lib/db/schema');
  const { eq, isNotNull, ne } = await import('drizzle-orm');

  const mode = args.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[fix-entities] mode=${mode}`);

  // -------------------------------------------------------------------------
  // 1. audits.summary — decode worstProducts + allProducts titles & categories
  // -------------------------------------------------------------------------
  const auditRows = await db
    .select({ id: audits.id, domain: audits.domain, summary: audits.summary })
    .from(audits)
    .where(isNotNull(audits.summary));
  console.log(`[fix-entities] scanning ${auditRows.length} audit summaries…`);

  let auditsChanged = 0;
  let titlesDecodedInAudits = 0;
  const samples: Array<{ before: string; after: string; where: string }> = [];

  for (const row of auditRows) {
    const summary = row.summary as AuditSummary | null;
    if (!summary || typeof summary !== 'object') continue;

    let touched = false;

    const decodeList = (list: SummaryProduct[] | undefined, where: string): void => {
      if (!Array.isArray(list)) return;
      for (const p of list) {
        if (typeof p?.title === 'string') {
          const decoded = decodeHtmlEntities(p.title);
          if (decoded !== p.title) {
            if (samples.length < args.sampleSize) {
              samples.push({ before: p.title, after: decoded, where: `${row.domain} ${where}` });
            }
            p.title = decoded;
            touched = true;
            titlesDecodedInAudits += 1;
          }
        }
        if (p?.signals?.productType && typeof p.signals.productType === 'string') {
          const decoded = decodeHtmlEntities(p.signals.productType);
          if (decoded !== p.signals.productType) {
            p.signals.productType = decoded;
            touched = true;
          }
        }
      }
    };

    decodeList(summary.worstProducts, 'worst');
    decodeList(summary.allProducts, 'all');

    if (touched) {
      auditsChanged += 1;
      if (args.apply) {
        await db.update(audits).set({ summary }).where(eq(audits.id, row.id));
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. products.title — the dashboard / bulk modal reads here, not from
  //    the cached summary, so we need a parallel pass.
  // -------------------------------------------------------------------------
  const productRows = await db
    .select({ id: products.id, title: products.title })
    .from(products)
    .where(ne(products.title, ''));
  console.log(`[fix-entities] scanning ${productRows.length} products…`);

  let productsChanged = 0;
  for (const row of productRows) {
    if (!row.title) continue;
    const decoded = decodeHtmlEntities(row.title);
    if (decoded === row.title) continue;
    if (samples.length < args.sampleSize) {
      samples.push({ before: row.title, after: decoded, where: `product ${row.id.slice(0, 8)}` });
    }
    productsChanged += 1;
    if (args.apply) {
      await db.update(products).set({ title: decoded }).where(eq(products.id, row.id));
    }
  }

  // -------------------------------------------------------------------------
  // 3. Report
  // -------------------------------------------------------------------------
  console.log('\n[fix-entities] samples (before → after):');
  if (samples.length === 0) {
    console.log('  (no decodable entities found anywhere)');
  } else {
    for (const s of samples) {
      console.log(`  · [${s.where}]`);
      console.log(`     BEFORE: ${s.before}`);
      console.log(`     AFTER : ${s.after}`);
    }
  }

  console.log(
    `\n[fix-entities] summary:` +
      `\n  audits.summary touched: ${auditsChanged} / ${auditRows.length}` +
      `\n  titles decoded inside summaries: ${titlesDecodedInAudits}` +
      `\n  products.title rows touched: ${productsChanged} / ${productRows.length}` +
      `\n  mode: ${args.apply ? 'APPLIED' : 'DRY-RUN (no writes)'}`
  );
  if (!args.apply && (auditsChanged > 0 || productsChanged > 0)) {
    console.log(`\n  → re-run with --apply to persist.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
