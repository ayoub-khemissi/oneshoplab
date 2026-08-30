/**
 * Pre-run anonymous audits on merchant leads so the cold mailer can
 * embed a "see your audit report" button in the email. Targets the
 * shopify / woocommerce / wix populations exclusively — for any other
 * platform the catalog probe wouldn't return products.
 *
 * Usage:
 *
 *   pnpm tsx scripts/preaudit-leads.ts --lang fr [--limit 50] [--concurrency 3]
 *   pnpm tsx scripts/preaudit-leads.ts --lang en --limit 20
 *
 * Idempotent: leads whose latest anon audit completed in the last 24h
 * are skipped (handled by launchAnonymousAudit's own reuse logic, but
 * we also short-circuit before calling so the run report shows the
 * skip count accurately).
 *
 * Each audit is launched then polled until status flips out of
 * 'pending' (timeout 120s per audit, exit-on-failure not enforced —
 * partial batches are useful).
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
  lang: 'fr' | 'en';
  limit: number;
  concurrency: number;
  pollIntervalMs: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  let lang: 'fr' | 'en' | null = null;
  let limit = 50;
  let concurrency = 3;
  let pollIntervalMs = 5_000;
  let timeoutMs = 120_000;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--lang' && next) {
      if (next !== 'fr' && next !== 'en') {
        console.error('--lang must be fr | en');
        process.exit(1);
      }
      lang = next;
      i++;
    } else if (a === '--limit' && next) {
      limit = Math.max(1, Math.min(500, Number(next)));
      i++;
    } else if (a === '--concurrency' && next) {
      concurrency = Math.max(1, Math.min(10, Number(next)));
      i++;
    } else if (a === '--timeout' && next) {
      timeoutMs = Math.max(10_000, Math.min(600_000, Number(next)));
      i++;
    }
  }

  if (!lang) {
    console.error(
      'Usage:\n' +
        '  pnpm tsx scripts/preaudit-leads.ts --lang fr [--limit 50] [--concurrency 3]\n' +
        '\n' +
        'Picks merchant leads (platform in shopify/woo/wix, status=new) matching\n' +
        '--lang, then launches an anonymous audit for any domain without a fresh\n' +
        '(24h) completed audit. Polls each until completed/failed (timeout 120s\n' +
        'by default, --timeout to override in ms).'
    );
    process.exit(1);
  }
  return { lang, limit, concurrency, pollIntervalMs, timeoutMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const FRESH_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const { launchAnonymousAudit, normalizeUrl } = await import('@/features/run-audit');
  const { db } = await import('@/lib/db');
  const { audits, leads } = await import('@/lib/db/schema');
  const { and, desc, eq, gt, isNotNull, isNull, or, sql } = await import('drizzle-orm');

  const langPredicate =
    args.lang === 'fr'
      ? eq(leads.language, 'fr')
      : sql`(${leads.language} = 'en' OR ${leads.language} IS NULL)`;

  const merchantPredicate = or(
    eq(leads.platform, 'shopify'),
    eq(leads.platform, 'woocommerce'),
    eq(leads.platform, 'wix')
  );

  const rows = await db
    .select({
      id: leads.id,
      domain: leads.domain,
      url: leads.url,
      platform: leads.platform
    })
    .from(leads)
    .where(
      and(eq(leads.status, 'new'), isNotNull(leads.contactEmail), langPredicate, merchantPredicate)
    )
    .limit(args.limit * 2);

  // Filter out leads whose audit is already fresh — avoids paying the
  // poll round-trip for an audit launchAnonymousAudit would skip anyway.
  const cutoff = new Date(Date.now() - FRESH_MS);
  const queue: typeof rows = [];
  for (const r of rows) {
    if (queue.length >= args.limit) break;
    const recent = await db.query.audits.findFirst({
      where: and(
        isNull(audits.projectId),
        isNotNull(audits.anonToken),
        eq(audits.domain, r.domain),
        eq(audits.status, 'completed'),
        gt(audits.createdAt, cutoff)
      ),
      columns: { id: true }
    });
    if (recent) continue;
    queue.push(r);
  }

  console.log(
    `[preaudit-leads] lang=${args.lang} candidates=${rows.length} fresh-skipped=${rows.length - queue.length} to-process=${queue.length}`
  );
  if (queue.length === 0) return;

  let completed = 0;
  let failed = 0;
  let timedOut = 0;

  // Wait until status reaches a terminal value (completed / failed /
  // timeout). 'pending' and 'running' are both transient — the audit
  // moves pending → running → completed (or failed) — so we keep
  // polling until it leaves both.
  const TERMINAL = new Set(['completed', 'failed', 'timeout']);
  async function pollAuditUntilDone(auditId: string): Promise<string> {
    const deadline = Date.now() + args.timeoutMs;
    while (Date.now() < deadline) {
      const row = await db.query.audits.findFirst({
        where: eq(audits.id, auditId),
        columns: { status: true }
      });
      if (row && TERMINAL.has(row.status)) return row.status;
      await sleep(args.pollIntervalMs);
    }
    return 'timeout';
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const lead = queue[idx];
      const norm = normalizeUrl(lead.url);
      if (!norm) {
        console.log(`  [${idx + 1}/${queue.length}] ${lead.domain}  (skip: bad url)`);
        failed += 1;
        continue;
      }
      const t0 = Date.now();
      let auditToken: string;
      try {
        const r = await launchAnonymousAudit(norm);
        auditToken = r.token;
      } catch (e) {
        console.error(
          `  [${idx + 1}/${queue.length}] ${lead.domain}  (launch failed: ${(e as Error).message})`
        );
        failed += 1;
        continue;
      }

      // We need the audit ROW id (not the anon token) to poll. Look it
      // up by token. If launchAnonymousAudit reused an existing one,
      // we still find it the same way.
      const audit = await db.query.audits.findFirst({
        where: eq(audits.anonToken, auditToken),
        columns: { id: true, status: true },
        orderBy: [desc(audits.createdAt)]
      });
      if (!audit) {
        console.error(`  [${idx + 1}/${queue.length}] ${lead.domain}  (lost audit row?)`);
        failed += 1;
        continue;
      }
      if (audit.status === 'completed') {
        console.log(
          `  [${idx + 1}/${queue.length}] ${lead.domain}  ✓ reused (token=${auditToken.slice(0, 8)}…)`
        );
        completed += 1;
        continue;
      }

      const finalStatus = await pollAuditUntilDone(audit.id);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      if (finalStatus === 'completed') {
        console.log(
          `  [${idx + 1}/${queue.length}] ${lead.domain}  ✓ completed in ${dt}s (token=${auditToken.slice(0, 8)}…)`
        );
        completed += 1;
      } else if (finalStatus === 'timeout') {
        console.log(`  [${idx + 1}/${queue.length}] ${lead.domain}  ⏱ timeout after ${dt}s`);
        timedOut += 1;
      } else {
        console.log(`  [${idx + 1}/${queue.length}] ${lead.domain}  ✗ ${finalStatus} in ${dt}s`);
        failed += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(args.concurrency, queue.length)) }, worker)
  );

  console.log(
    `\n[preaudit-leads] done. completed=${completed} failed=${failed} timeout=${timedOut}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
