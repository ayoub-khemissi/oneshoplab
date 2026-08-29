/**
 * Profitability audit — compares the credits we DEBIT users via
 * `jobs.creditsCost` against the credits kie.ai actually CONSUMED for
 * those same calls. Outputs a per-kind table with revenue ($), cost
 * ($) and margin (%).
 *
 * Sources of truth, by job kind:
 *
 *   - `kie_title|description|tags`  → `result.kieCreditsConsumed` is
 *     persisted at write time (see lib/ai/optims.ts) from the
 *     `/claude/v1/messages` response body. No HTTP roundtrip needed.
 *
 *   - `kie_image_edit|generate`     → kie's `/api/v1/jobs/recordInfo`
 *     endpoint exposes `data.creditsConsumed`. We persist the
 *     `kieTaskId` on the job row, so we just walk through those rows
 *     and fetch each task. There is no list endpoint upstream
 *     (verified: `/jobs/list`, `/usage`, `/billing/*` all 404).
 *
 *   - `kie_dynamic_audit|alt_text…` → not persisted today. Reported
 *     as "unknown" in the output so the gap is visible.
 *
 * Pricing math (from `pricing.json`):
 *
 *   revenue_usd = user_credits_debited × creditUsdValue
 *   cost_usd    = kie_credits_consumed × providerUnitUsd
 *   margin %    = (revenue - cost) / revenue
 *
 * Usage:
 *   pnpm tsx scripts/audit-kie-profitability.ts                # last 30 days
 *   pnpm tsx scripts/audit-kie-profitability.ts --days 7
 *   pnpm tsx scripts/audit-kie-profitability.ts --days 90 --no-fetch
 *     # `--no-fetch` skips the kie.ai roundtrip for image jobs (faster,
 *     # but image cost will be reported as "unknown")
 */
import { existsSync, readFileSync } from 'node:fs';

// Load .env synchronously, BEFORE importing modules that read process.env
// at module-load time (db, kie client). Mirrors reconcile-kie-jobs.ts.
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
  days: number;
  noFetch: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let days = 30;
  let noFetch = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days' && argv[i + 1]) {
      days = Math.max(1, Math.min(365, Number(argv[i + 1])));
      i++;
    } else if (argv[i] === '--no-fetch') {
      noFetch = true;
    }
  }
  return { days, noFetch };
}

interface Aggregate {
  count: number;
  countWithKieCost: number;
  userCreditsDebited: number;
  kieCreditsConsumed: number;
  kieCostUnknownCount: number;
}

function emptyAgg(): Aggregate {
  return {
    count: 0,
    countWithKieCost: 0,
    userCreditsDebited: 0,
    kieCreditsConsumed: 0,
    kieCostUnknownCount: 0
  };
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtPct(num: number, den: number): string {
  if (den <= 0) return '   —  ';
  return `${(((den - num) / den) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const { and, eq, gte, isNotNull, sql } = await import('drizzle-orm');
  const { db } = await import('@/lib/db');
  const { jobs } = await import('@/lib/db/schema');
  const { getKieClient } = await import('@/lib/ai/kie');
  const { PRICING } = await import('@/lib/ai/pricing');

  const since = new Date(Date.now() - args.days * 86_400_000);

  console.log(
    `Auditing jobs.status='completed' since ${since.toISOString().slice(0, 10)} (${args.days} days).`
  );
  console.log(
    `Pricing: 1 user credit = $${PRICING.creditUsdValue}, ` +
      `1 kie credit = $${PRICING.providerUnitUsd}, ` +
      `markup target = ${PRICING.creditMarkupFactor}×.`
  );
  console.log();

  // 1. Pull every completed kie_* job within the window. We don't pre-
  //    filter on `result` shape because we want to count rows with
  //    missing cost data too (reported as "unknown").
  const rows = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      creditsCost: jobs.creditsCost,
      kieTaskId: jobs.kieTaskId,
      result: jobs.result,
      createdAt: jobs.createdAt
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'completed'),
        gte(jobs.createdAt, since),
        sql`${jobs.kind} LIKE 'kie_%'`
      )
    );

  console.log(`Found ${rows.length} completed kie_* jobs in window.`);

  // 2. For image jobs we need to roundtrip to kie's recordInfo. Bucket
  //    those by id so we can short-circuit when a job already has
  //    cost in `result.kieCreditsConsumed` (rare for images today,
  //    but the field is there for forward-compatibility).
  const kie = args.noFetch ? null : getKieClient();
  const agg: Record<string, Aggregate> = {};

  // kie_dynamic_audit is a public-audit narration we eat (see
  // lib/ai/dynamic-audit.ts:286 — creditsCost there is the kie raw
  // cost, never a user debit). Don't count it as revenue.
  const IS_FREE_KIND = (kind: string): boolean => kind === 'kie_dynamic_audit';

  let fetched = 0;
  let fetchErrors = 0;
  for (const r of rows) {
    const a = (agg[r.kind] ??= emptyAgg());
    a.count++;

    const costCol = Number(r.creditsCost ?? 0);
    if (IS_FREE_KIND(r.kind)) {
      // creditsCost column on these rows IS the kie credit cost.
      // No user debit, no revenue.
      a.kieCreditsConsumed += costCol;
      a.countWithKieCost++;
      continue;
    }

    a.userCreditsDebited += costCol;

    const resultObj = (r.result ?? null) as
      | { kieCreditsConsumed?: number }
      | null;
    const inlineCost =
      resultObj && typeof resultObj.kieCreditsConsumed === 'number'
        ? resultObj.kieCreditsConsumed
        : null;

    if (inlineCost != null) {
      a.countWithKieCost++;
      a.kieCreditsConsumed += inlineCost;
      continue;
    }

    // Try kie recordInfo if we have a taskId and aren't in --no-fetch.
    if (kie && r.kieTaskId) {
      try {
        const info = await kie.getTask(r.kieTaskId);
        // The kie docs document this field as `creditsConsumed` on
        // task.data; some legacy records use `costTime` (seconds —
        // unrelated to credits). Guard with typeof === 'number'.
        const cc = (info as unknown as { creditsConsumed?: number })
          .creditsConsumed;
        if (typeof cc === 'number') {
          a.countWithKieCost++;
          a.kieCreditsConsumed += cc;
          fetched++;
          continue;
        }
      } catch (e) {
        fetchErrors++;
        process.stderr.write(
          `  [warn] recordInfo failed for ${r.kieTaskId}: ${(e as Error).message}\n`
        );
      }
    }

    a.kieCostUnknownCount++;
  }
  if (kie) {
    console.log(
      `Fetched ${fetched} kie task records (errors: ${fetchErrors}).\n`
    );
  }

  // 3. Pretty-print the per-kind breakdown.
  const kinds = Object.keys(agg).sort();
  const colWidth = {
    kind: Math.max(20, ...kinds.map((k) => k.length)),
    count: 6,
    userCr: 12,
    kieCr: 12,
    revenue: 11,
    cost: 11,
    margin: 8
  };

  const header =
    `${'kind'.padEnd(colWidth.kind)}  ` +
    `${'count'.padStart(colWidth.count)}  ` +
    `${'user_cr'.padStart(colWidth.userCr)}  ` +
    `${'kie_cr'.padStart(colWidth.kieCr)}  ` +
    `${'revenue'.padStart(colWidth.revenue)}  ` +
    `${'cost'.padStart(colWidth.cost)}  ` +
    `${'margin'.padStart(colWidth.margin)}`;
  console.log(header);
  console.log('─'.repeat(header.length));

  let totalUserCredits = 0;
  let totalKieCredits = 0;
  let totalUnknown = 0;

  for (const kind of kinds) {
    const a = agg[kind];
    const revenue = a.userCreditsDebited * PRICING.creditUsdValue;
    const cost = a.kieCreditsConsumed * PRICING.providerUnitUsd;
    const margin = fmtPct(cost, revenue);

    const unknownSuffix =
      a.kieCostUnknownCount > 0 ? `  (${a.kieCostUnknownCount} no-cost)` : '';
    console.log(
      `${kind.padEnd(colWidth.kind)}  ` +
        `${String(a.count).padStart(colWidth.count)}  ` +
        `${a.userCreditsDebited.toFixed(2).padStart(colWidth.userCr)}  ` +
        `${a.kieCreditsConsumed.toFixed(2).padStart(colWidth.kieCr)}  ` +
        `${fmtUsd(revenue).padStart(colWidth.revenue)}  ` +
        `${fmtUsd(cost).padStart(colWidth.cost)}  ` +
        `${margin.padStart(colWidth.margin)}${unknownSuffix}`
    );

    totalUserCredits += a.userCreditsDebited;
    totalKieCredits += a.kieCreditsConsumed;
    totalUnknown += a.kieCostUnknownCount;
  }

  console.log('─'.repeat(header.length));
  const totalRevenue = totalUserCredits * PRICING.creditUsdValue;
  const totalCost = totalKieCredits * PRICING.providerUnitUsd;
  console.log(
    `${'TOTAL'.padEnd(colWidth.kind)}  ` +
      `${String(rows.length).padStart(colWidth.count)}  ` +
      `${totalUserCredits.toFixed(2).padStart(colWidth.userCr)}  ` +
      `${totalKieCredits.toFixed(2).padStart(colWidth.kieCr)}  ` +
      `${fmtUsd(totalRevenue).padStart(colWidth.revenue)}  ` +
      `${fmtUsd(totalCost).padStart(colWidth.cost)}  ` +
      `${fmtPct(totalCost, totalRevenue).padStart(colWidth.margin)}` +
      (totalUnknown > 0 ? `  (${totalUnknown} no-cost)` : '')
  );

  console.log();
  console.log(
    `Effective markup (revenue / cost): ` +
      `${totalCost > 0 ? (totalRevenue / totalCost).toFixed(2) : '—'}× ` +
      `(target: ${PRICING.creditMarkupFactor}×)`
  );

  // 4. Optional: report the kie account's remaining balance for context.
  if (kie) {
    try {
      const res = await fetch('https://api.kie.ai/api/v1/chat/credit', {
        headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` }
      });
      const j = (await res.json()) as { data?: number };
      if (typeof j.data === 'number') {
        console.log(`kie balance now: ${j.data.toFixed(2)} credits.`);
      }
    } catch {
      /* non-fatal */
    }
  }

  if (totalUnknown > 0) {
    console.log();
    console.log(
      `Note: ${totalUnknown} job(s) have no kie cost recorded. ` +
        `Likely kinds: kie_dynamic_audit / kie_alt_text (not yet ` +
        `persisting credits_consumed). Margin above is computed on the ` +
        `subset where cost IS known.`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
