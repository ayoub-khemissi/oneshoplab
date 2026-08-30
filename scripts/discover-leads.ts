/**
 * Lead discovery CLI. Pulls candidate URLs from a discovery provider
 * (seed file or Brave Search), runs each through the qualification
 * pipeline (platform detect + product fetch + contact extraction),
 * and upserts the qualified ones into the `leads` table.
 *
 * Usage:
 *
 *   # Seed file (one URL per line, # = comment):
 *   pnpm tsx scripts/discover-leads.ts --file seeds.txt
 *
 *   # Brave Search query (needs BRAVE_API_KEY in .env):
 *   pnpm tsx scripts/discover-leads.ts \
 *     --query '"powered by shopify" inurl:/products' \
 *     --country fr --limit 50
 *
 * Idempotent: re-running with the same query / file refreshes existing
 * leads (platform / contact info / qualifiedAt) without overwriting
 * statuses the operator has moved past "new".
 */
import { existsSync, readFileSync } from 'node:fs';

// Load .env synchronously, BEFORE importing modules that read process.env
// at module init time (db, kie client, etc.). Same pattern as
// reconcile-kie-jobs.ts.
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

type CliMode =
  | { kind: 'seed'; input: string }
  | { kind: 'query'; input: string }
  | { kind: 'platform'; platform: 'shopify' | 'woocommerce' | 'wix' }
  | {
      kind: 'alt-platform';
      platform: 'magento' | 'prestashop' | 'bigcommerce' | 'squarespace' | 'all';
    }
  | { kind: 'cc'; pattern: 'shopify' | 'wix' }
  | { kind: 'niche' }
  | { kind: 'tranco'; startRank: number; endRank: number };

interface CliArgs {
  mode: CliMode;
  country?: string;
  limit: number;
  concurrency: number;
  skipKnown: boolean;
  /** Skip store qualification — just scrape contact info and upsert
   *  (agencies, freelancers…). Pair with --file <agencies.txt>. */
  contactsOnly: boolean;
  /** Fall back to alt-platform fingerprint when the native S/W/W
   *  qualifier returns platform_not_detected. Boosts yield on
   *  --niche / --query runs by capturing Magento / PrestaShop /
   *  BigCommerce / Squarespace shops we'd otherwise skip. */
  withAlt: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let mode: CliMode | null = null;
  let country: string | undefined;
  let limit = 100;
  let concurrency = 5;
  let skipKnown = false;
  let contactsOnly = false;
  let withAlt = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--file' && next) {
      mode = { kind: 'seed', input: next };
      i++;
    } else if (a === '--query' && next) {
      mode = { kind: 'query', input: next };
      i++;
    } else if (a === '--platform' && next) {
      if (next !== 'shopify' && next !== 'woocommerce' && next !== 'wix') {
        console.error(`--platform must be shopify | woocommerce | wix`);
        process.exit(1);
      }
      mode = { kind: 'platform', platform: next };
      i++;
    } else if (a === '--alt-platform' && next) {
      if (
        next !== 'magento' &&
        next !== 'prestashop' &&
        next !== 'bigcommerce' &&
        next !== 'squarespace' &&
        next !== 'all'
      ) {
        console.error(
          `--alt-platform must be magento | prestashop | bigcommerce | squarespace | all`
        );
        process.exit(1);
      }
      mode = { kind: 'alt-platform', platform: next };
      i++;
    } else if (a === '--cc' && next) {
      if (next !== 'shopify' && next !== 'wix') {
        console.error(`--cc must be shopify | wix (Common Crawl pattern)`);
        process.exit(1);
      }
      mode = { kind: 'cc', pattern: next };
      i++;
    } else if (a === '--niche') {
      mode = { kind: 'niche' };
    } else if (a === '--tranco') {
      // `--tranco` alone defaults to range 5000-50000.
      // `--tranco 5000-50000` or two numbers also accepted.
      let startRank = 5_000;
      let endRank = 50_000;
      if (next && /^\d+(-\d+)?$/.test(next)) {
        if (next.includes('-')) {
          const [a1, b1] = next.split('-').map((n) => Number(n));
          startRank = Math.max(1, a1);
          endRank = Math.max(startRank + 1, b1);
        } else {
          startRank = 5_000;
          endRank = Math.max(startRank + 1, Number(next));
        }
        i++;
      }
      endRank = Math.min(1_000_000, endRank);
      mode = { kind: 'tranco', startRank, endRank };
    } else if (a === '--country' && next) {
      country = next.toLowerCase();
      i++;
    } else if (a === '--limit' && next) {
      limit = Math.max(1, Math.min(2000, Number(next)));
      i++;
    } else if (a === '--concurrency' && next) {
      concurrency = Math.max(1, Math.min(20, Number(next)));
      i++;
    } else if (a === '--skip-known') {
      skipKnown = true;
    } else if (a === '--contacts-only') {
      contactsOnly = true;
    } else if (a === '--with-alt') {
      withAlt = true;
    }
  }

  if (!mode) {
    console.error(
      'Usage:\n' +
        '  pnpm tsx scripts/discover-leads.ts --file <path>\n' +
        '  pnpm tsx scripts/discover-leads.ts --query <text> [--country fr] [--limit 100]\n' +
        '  pnpm tsx scripts/discover-leads.ts --platform shopify --country fr [--limit 500]\n' +
        '  pnpm tsx scripts/discover-leads.ts --cc shopify [--limit 500]    # Common Crawl, free, recommended for Shopify/Wix bulk\n' +
        '  pnpm tsx scripts/discover-leads.ts --cc wix [--limit 500]\n' +
        '  pnpm tsx scripts/discover-leads.ts --niche --country fr           # Brave + 15 niche queries (mode, cosmétique, déco…) — platform-agnostic\n' +
        '  pnpm tsx scripts/discover-leads.ts --tranco 50000 [--limit N]     # Probe top-50k domains from Tranco list (free, ~1h, ~500-2000 shops)\n' +
        '  pnpm tsx scripts/discover-leads.ts --alt-platform magento --country fr [--limit 100]   # Brave + signature fingerprint for non-S/W/W shops\n' +
        '                                                                  Variants: magento | prestashop | bigcommerce | squarespace | all\n' +
        '\n' +
        'Options:\n' +
        '  --concurrency <n>   Parallel qualifier workers (default 5, max 20).\n' +
        '  --skip-known        Skip candidate domains already in the leads table.\n' +
        '  --contacts-only     No store qualification — just scrape contact\n' +
        '                      info + upsert. For agencies/freelancers:\n' +
        '                      pnpm tsx scripts/discover-leads.ts --contacts-only --file agencies.txt\n' +
        '  --with-alt          When the S/W/W qualifier returns platform_not_detected,\n' +
        '                      run alt-platform fingerprint (Magento/PrestaShop/\n' +
        '                      BigCommerce/Squarespace) on the same HTML and upsert\n' +
        '                      as platform=manual + notes=detected:<x>. Best paired\n' +
        '                      with --niche to harvest non-S/W/W shops alongside.\n'
    );
    process.exit(1);
  }
  return { mode, country, limit, concurrency, skipKnown, contactsOnly, withAlt };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const {
    buildProvider,
    getQueryTemplates,
    getNicheQueries,
    multiBraveDiscovery,
    isBlockedDomain,
    CommonCrawlProvider,
    TrancoProvider
  } = await import('@/lib/leads/discovery');
  const { qualifyBatch } = await import('@/lib/leads/qualify');

  // Materialise the candidate stream upfront so we know what we're
  // working with before hitting any merchant servers. The provider's
  // own dedupe + limit bound the size.
  const candidates: string[] = [];
  let sourceLabel: string | null = null;

  if (args.mode.kind === 'tranco') {
    const span = args.mode.endRank - args.mode.startRank;
    console.log(
      `[discover-leads] tranco rank ${args.mode.startRank}-${args.mode.endRank} (${span} domains) qualify-limit=${args.limit}`
    );
    const provider = new TrancoProvider(args.mode.startRank, args.mode.endRank);
    for await (const c of provider.discover({ limit: span })) {
      if (candidates.length >= args.limit) break;
      let host: string;
      try {
        host = new URL(c.url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        continue;
      }
      if (isBlockedDomain(host)) continue;
      candidates.push(c.url);
      sourceLabel = c.source;
    }
  } else if (args.mode.kind === 'cc') {
    const pattern = args.mode.pattern === 'shopify' ? '*.myshopify.com' : '*.wixsite.com';
    console.log(`[discover-leads] common-crawl pattern=${pattern} limit=${args.limit}`);
    const provider = new CommonCrawlProvider(pattern);
    for await (const c of provider.discover({ limit: args.limit })) {
      let host: string;
      try {
        host = new URL(c.url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        continue;
      }
      if (isBlockedDomain(host)) continue;
      candidates.push(c.url);
      sourceLabel = c.source;
    }
  } else if (args.mode.kind === 'niche') {
    const queries = getNicheQueries(args.country);
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      console.error('BRAVE_API_KEY missing. Niche discovery uses Brave Search.');
      process.exit(1);
    }
    const perQueryLimit = Math.max(10, Math.ceil(args.limit / queries.length));
    console.log(
      `[discover-leads] niche country=${args.country ?? 'en'} queries=${queries.length} perQueryLimit=${perQueryLimit}`
    );
    for (const q of queries) console.log(`  - ${q}`);
    for await (const c of multiBraveDiscovery(queries, apiKey, args.country, perQueryLimit)) {
      if (candidates.length >= args.limit) break;
      candidates.push(c.url);
      sourceLabel = `niche:${args.country ?? 'en'}`;
    }
  } else if (args.mode.kind === 'alt-platform') {
    const { altPlatformQueries, ALT_PLATFORMS, isAltPlatformBlocked } =
      await import('@/lib/leads/alt-platforms');
    const lang: 'fr' | 'en' = args.country === 'fr' ? 'fr' : 'en';
    const platforms: ReadonlyArray<'magento' | 'prestashop' | 'bigcommerce' | 'squarespace'> =
      args.mode.platform === 'all' ? ALT_PLATFORMS : [args.mode.platform];
    const queries: string[] = [];
    for (const p of platforms) {
      for (const q of altPlatformQueries(p, lang)) queries.push(q);
    }
    if (queries.length === 0) {
      console.error(`No alt-platform queries for platform=${args.mode.platform} lang=${lang}`);
      process.exit(1);
    }
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      console.error('BRAVE_API_KEY missing. --alt-platform uses Brave Search.');
      process.exit(1);
    }
    const perQueryLimit = Math.max(15, Math.ceil(args.limit / queries.length));
    console.log(
      `[discover-leads] alt-platform=${args.mode.platform} lang=${lang} queries=${queries.length} perQueryLimit=${perQueryLimit}`
    );
    for (const q of queries) console.log(`  - ${q}`);
    for await (const c of multiBraveDiscovery(queries, apiKey, args.country, perQueryLimit)) {
      if (candidates.length >= args.limit) break;
      let host: string;
      try {
        host = new URL(c.url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        continue;
      }
      // Cheap pre-filter: the platforms' own docs / forums / app
      // vendors are always in the Brave SERP for these queries and
      // never the merchants we want.
      if (isAltPlatformBlocked(host)) continue;
      candidates.push(c.url);
      sourceLabel = `alt-platform:${args.mode.platform}-${lang}`;
    }
  } else if (args.mode.kind === 'platform') {
    const queries = getQueryTemplates(args.mode.platform, args.country);
    if (queries.length === 0) {
      console.error(
        `No query templates for platform=${args.mode.platform} country=${args.country ?? 'en'}`
      );
      process.exit(1);
    }
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      console.error(
        'BRAVE_API_KEY missing. Register at https://api-dashboard.search.brave.com/ ' +
          'and add the key to .env, or use --file <seed.txt> instead.'
      );
      process.exit(1);
    }
    const perQueryLimit = Math.max(20, Math.ceil(args.limit / queries.length));
    console.log(
      `[discover-leads] platform=${args.mode.platform} country=${args.country ?? 'en'} ` +
        `queries=${queries.length} perQueryLimit=${perQueryLimit}`
    );
    for (const q of queries) console.log(`  - ${q}`);
    for await (const c of multiBraveDiscovery(queries, apiKey, args.country, perQueryLimit)) {
      if (candidates.length >= args.limit) break;
      candidates.push(c.url);
      sourceLabel = `brave-multi:${args.mode.platform}-${args.country ?? 'en'}`;
    }
  } else {
    const provider = buildProvider({
      kind: args.mode.kind === 'seed' ? 'seed' : 'brave',
      input: args.mode.input,
      country: args.country
    });
    console.log(
      `[discover-leads] provider=${args.mode.kind} input=${JSON.stringify(args.mode.input)} limit=${args.limit}` +
        (args.country ? ` country=${args.country}` : '')
    );
    for await (const c of provider.discover({ limit: args.limit })) {
      // Apply the blocklist even on raw query mode so manual queries
      // also benefit from the noise filter.
      let host: string;
      try {
        host = new URL(c.url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        continue;
      }
      if (isBlockedDomain(host)) continue;
      candidates.push(c.url);
      sourceLabel = c.source;
    }
  }

  console.log(`[discover-leads] collected ${candidates.length} candidate URL(s)`);

  // Pre-filter against already-qualified domains. Re-running the same
  // CC pattern would otherwise burn time re-fetching shops we already
  // have. Refreshing them is still useful occasionally — that's the
  // default; --skip-known turns the filter on.
  let toQualify = candidates;
  if (args.skipKnown) {
    const { db } = await import('@/lib/db');
    const { leads } = await import('@/lib/db/schema');
    const known = new Set(
      (await db.select({ domain: leads.domain }).from(leads)).map((r) => r.domain.toLowerCase())
    );
    const before = candidates.length;
    toQualify = candidates.filter((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
        return !known.has(h);
      } catch {
        return true;
      }
    });
    console.log(
      `[discover-leads] skip-known: filtered ${before - toQualify.length} known domain(s), qualifying ${toQualify.length}`
    );
  }

  // Contacts-only: skip store qualification, just scrape the contact
  // and upsert (agencies, freelancers, anyone without a catalog).
  if (args.contactsOnly) {
    const { extractContactInfo } = await import('@/lib/leads/contact-scraper');
    const { upsertContactLead } = await import('@/lib/leads/qualify');
    let created = 0;
    let refreshed = 0;
    let withEmail = 0;
    let errored = 0;
    for (const url of toQualify) {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        errored += 1;
        continue;
      }
      try {
        const c = await extractContactInfo(url);
        const r = await upsertContactLead({
          domain: host,
          url,
          email: c.email,
          socials: c.socials.slice(0, 8),
          discoveredVia: sourceLabel
        });
        if (r.created) created += 1;
        else refreshed += 1;
        if (r.hasEmail) withEmail += 1;
        console.log(`  ${r.created ? '+' : '~'} ${host.padEnd(40)} ${c.email ?? '(no email)'}`);
      } catch {
        errored += 1;
        console.log(`  ! ${host.padEnd(40)} extract failed`);
      }
    }
    console.log('\n── Summary (contacts-only) ─────────────────────');
    console.log(`  processed:   ${toQualify.length}`);
    console.log(`  upserted:    ${created} new, ${refreshed} refreshed`);
    console.log(`  with email:  ${withEmail}`);
    console.log(`  errored:     ${errored}`);
    process.exit(0);
  }

  // Alt-platform: fingerprint + has-products + contact scrape +
  // upsert as platform='manual' with the detected platform stored in
  // notes. Sequential by design — Brave gives us ~100s of candidates
  // tops here, the bottleneck is the fingerprint fetch which is
  // already polite (~5-10 req/s without concurrency).
  if (args.mode.kind === 'alt-platform') {
    const { fetchText } = await import('@/entities/store-adapter');
    const { extractContactInfo } = await import('@/lib/leads/contact-scraper');
    const { detectAltPlatform } = await import('@/lib/leads/alt-platforms');
    const { upsertManualMerchantLead } = await import('@/lib/leads/qualify');
    const lang: 'fr' | 'en' = args.country === 'fr' ? 'fr' : 'en';
    let created = 0;
    let refreshed = 0;
    let withEmail = 0;
    const upsertedBySig: Record<string, number> = {};
    let skippedNoSig = 0;
    let errored = 0;
    for (const url of toQualify) {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        errored += 1;
        continue;
      }
      try {
        const page = await fetchText(url);
        if (!page.ok || !page.body) {
          errored += 1;
          console.log(`  ! ${host.padEnd(40)} fetch failed (status ${page.status})`);
          continue;
        }
        const detected = detectAltPlatform(page.body);
        if (!detected) {
          skippedNoSig += 1;
          console.log(`  - ${host.padEnd(40)} no platform signature`);
          continue;
        }
        // Fingerprint already rejects blogs / docs / agencies that
        // merely mention the platform name (strong rules require
        // generator meta or platform-specific paths). Trusting the
        // detector alone keeps yield acceptable on Brave's noisy
        // SERP for these footprints.
        const contact = await extractContactInfo(page.finalUrl).catch(() => ({
          email: null as string | null,
          socials: [] as string[]
        }));
        const r = await upsertManualMerchantLead({
          domain: host,
          url: page.finalUrl,
          detectedPlatform: detected,
          language: lang,
          email: contact.email,
          socials: contact.socials.slice(0, 8),
          discoveredVia: sourceLabel
        });
        if (r.created) created += 1;
        else refreshed += 1;
        if (r.hasEmail) withEmail += 1;
        upsertedBySig[detected] = (upsertedBySig[detected] ?? 0) + 1;
        console.log(
          `  ${r.created ? '+' : '~'} ${host.padEnd(40)} ${detected.padEnd(11)} ${contact.email ?? '(no email)'}`
        );
      } catch (e) {
        errored += 1;
        console.log(`  ! ${host.padEnd(40)} ${(e as Error).message}`);
      }
    }
    console.log('\n── Summary (alt-platform) ─────────────────────');
    console.log(`  processed:        ${toQualify.length}`);
    console.log(`  upserted:         ${created} new, ${refreshed} refreshed`);
    console.log(`  with email:       ${withEmail}`);
    console.log(`  no platform sig:  ${skippedNoSig}`);
    console.log(`  errored:          ${errored}`);
    if (Object.keys(upsertedBySig).length > 0) {
      console.log('  by detected platform:');
      for (const [p, n] of Object.entries(upsertedBySig)) {
        console.log(`    ${p.padEnd(13)} ${n}`);
      }
    }
    process.exit(0);
  }

  // --with-alt: replace the default qualifyBatch path with a unified
  // loop that runs the native S/W/W qualifier first, then falls back
  // to the alt-platform fingerprint on the SAME homeHtml when the
  // first pass returns platform_not_detected. Single fetch per
  // candidate, ~2x the yield on --niche runs because we capture
  // Magento / PrestaShop / BigCommerce / Squarespace shops we'd
  // otherwise skip.
  if (args.withAlt) {
    const { qualifyUrl, upsertQualifiedLead, upsertManualMerchantLead, detectLanguage } =
      await import('@/lib/leads/qualify');
    const { detectAltPlatform } = await import('@/lib/leads/alt-platforms');
    const { extractContactInfo } = await import('@/lib/leads/contact-scraper');

    let sQualified = 0;
    let sNew = 0;
    let sRefreshed = 0;
    const byPlatform: Record<string, number> = {};
    let altUpserted = 0;
    let altNew = 0;
    let altRefreshed = 0;
    let skippedNoSig = 0;
    let skippedOther = 0;
    let errored = 0;

    let cursor = 0;
    async function worker(): Promise<void> {
      while (true) {
        const idx = cursor++;
        if (idx >= toQualify.length) return;
        const url = toQualify[idx];
        const outcome = await qualifyUrl(url);
        if (outcome.status === 'qualified') {
          const r = await upsertQualifiedLead(outcome, { discoveredVia: sourceLabel });
          sQualified += 1;
          if (r.created) sNew += 1;
          else sRefreshed += 1;
          byPlatform[outcome.platform] = (byPlatform[outcome.platform] ?? 0) + 1;
          console.log(
            `  ${r.created ? '+' : '~'} ${outcome.domain.padEnd(40)} ${outcome.platform.padEnd(11)} ${outcome.contactEmail ?? '(no email)'}`
          );
          continue;
        }
        if (
          outcome.status === 'skip' &&
          outcome.reason === 'platform_not_detected' &&
          outcome.homeHtml &&
          outcome.finalUrl
        ) {
          const detected = detectAltPlatform(outcome.homeHtml);
          if (!detected) {
            skippedNoSig += 1;
            console.log(`  - ${outcome.domain.padEnd(40)} no signature (S/W/W or alt)`);
            continue;
          }
          const contact = await extractContactInfo(outcome.finalUrl).catch(() => ({
            email: null as string | null,
            socials: [] as string[]
          }));
          const lang = detectLanguage(outcome.homeHtml);
          const r = await upsertManualMerchantLead({
            domain: outcome.domain,
            url: outcome.finalUrl,
            detectedPlatform: detected,
            language: lang,
            email: contact.email,
            socials: contact.socials.slice(0, 8),
            discoveredVia: sourceLabel
          });
          altUpserted += 1;
          if (r.created) altNew += 1;
          else altRefreshed += 1;
          byPlatform[detected] = (byPlatform[detected] ?? 0) + 1;
          console.log(
            `  ${r.created ? '+' : '~'} ${outcome.domain.padEnd(40)} ${detected.padEnd(11)} ${contact.email ?? '(no email)'}`
          );
          continue;
        }
        if (outcome.status === 'skip') {
          skippedOther += 1;
          console.log(`  - ${outcome.domain.padEnd(40)} ${outcome.reason}`);
        } else {
          errored += 1;
          console.log(`  ! ${outcome.domain.padEnd(40)} ${outcome.reason}`);
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(args.concurrency, toQualify.length)) }, worker)
    );

    console.log('\n── Summary (with --with-alt) ────────────────────');
    console.log(`  candidates:       ${toQualify.length}`);
    console.log(`  S/W/W qualified:  ${sQualified}  (${sNew} new, ${sRefreshed} refreshed)`);
    console.log(`  alt upserted:     ${altUpserted}  (${altNew} new, ${altRefreshed} refreshed)`);
    console.log(`  no signature:     ${skippedNoSig}`);
    console.log(`  other skip:       ${skippedOther}`);
    console.log(`  errored:          ${errored}`);
    if (Object.keys(byPlatform).length > 0) {
      console.log('  by platform:');
      for (const [p, n] of Object.entries(byPlatform).sort()) {
        console.log(`    ${p.padEnd(13)} ${n}`);
      }
    }
    process.exit(0);
  }

  const summary = await qualifyBatch(toQualify, sourceLabel, args.concurrency);

  console.log('\n── Summary ─────────────────────────────────────');
  console.log(`  candidates:  ${summary.total}`);
  console.log(
    `  qualified:   ${summary.qualified}  (${summary.created} new, ${summary.qualified - summary.created} refreshed)`
  );
  console.log(`  skipped:     ${summary.skipped}`);
  console.log(`  errored:     ${summary.errored}`);
  if (Object.keys(summary.byPlatform).length > 0) {
    console.log('  by platform:');
    for (const [p, n] of Object.entries(summary.byPlatform)) {
      console.log(`    ${p.padEnd(13)} ${n}`);
    }
  }
  if (summary.failures.length > 0 && summary.failures.length <= 20) {
    console.log('\n  Failures:');
    for (const f of summary.failures) {
      console.log(`    ${f.domain.padEnd(40)} ${f.reason}`);
    }
  } else if (summary.failures.length > 20) {
    console.log(`\n  ${summary.failures.length} failures total — first 10:`);
    for (const f of summary.failures.slice(0, 10)) {
      console.log(`    ${f.domain.padEnd(40)} ${f.reason}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
