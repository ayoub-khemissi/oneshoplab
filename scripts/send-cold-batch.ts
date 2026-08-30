/**
 * Cold-outreach send CLI. Pulls candidate leads from the CRM and emails
 * the v1 touch-1 template via Hostinger SMTP on get-oneshoplab.com.
 * Three modes, from safest to live:
 *
 *   # 1) Dry-run — render to console, no SMTP, no DB writes.
 *   pnpm tsx scripts/send-cold-batch.ts --lang fr --dry-run --limit 3
 *
 *   # 2) Test inbox — actually sends, but to YOUR address; no DB writes.
 *   #    Lets you preview what real prospects will receive.
 *   pnpm tsx scripts/send-cold-batch.ts \
 *     --lang fr --test-email khemayoub@gmail.com --limit 3
 *
 *   # 3) Live — sends to the real lead, records into lead_attempts,
 *   #    flips status 'new' → 'contacted'. Default --limit is 1 for
 *   #    safety; raise it explicitly once you're confident.
 *   pnpm tsx scripts/send-cold-batch.ts --lang fr --touch 1 --limit 1
 *
 * Selection in all modes: status='new' + contactEmail not null +
 * lang-match (lead.language=fr for --lang fr, lead.language=en or null
 * for --lang en). --lead-id <uuid> overrides selection to a single lead.
 *
 * Live mode adds a 45s±15s pause between sends to look human and avoid
 * tripping the Hostinger SMTP rate limit.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { ColdVariant } from '@/features/cold-outreach';

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

type Mode = 'dry-run' | 'test-email' | 'live';
type VariantFilter = 'agency' | 'merchant' | 'auto';

import {
  isGibberishMyshopify,
  isPlaceholderAddress,
  isSensitiveAddress,
  isValidContactEmail,
  SENSITIVE_LOCALPARTS
} from '@/entities/lead';

interface CliArgs {
  mode: Mode;
  lang: 'fr' | 'en';
  touch: 1;
  limit: number;
  testEmail: string | null;
  leadId: string | null;
  /** 'auto' picks per-lead from lead.platform; 'agency'/'merchant'
   *  filters the candidate query so only that population is touched. */
  variant: VariantFilter;
}

function parseArgs(argv: string[]): CliArgs {
  let mode: Mode = 'dry-run';
  let lang: 'fr' | 'en' | null = null;
  let touch: 1 = 1;
  let limit = 1;
  let testEmail: string | null = null;
  let leadId: string | null = null;
  let variant: VariantFilter = 'auto';

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
    } else if (a === '--touch' && next) {
      const n = Number(next);
      if (n !== 1) {
        console.error('--touch must be 1 (only touch 1 ships in v1)');
        process.exit(1);
      }
      touch = 1;
      i++;
    } else if (a === '--variant' && next) {
      if (next !== 'agency' && next !== 'merchant') {
        console.error('--variant must be agency | merchant');
        process.exit(1);
      }
      variant = next;
      i++;
    } else if (a === '--dry-run') {
      mode = 'dry-run';
    } else if (a === '--test-email' && next) {
      mode = 'test-email';
      testEmail = next;
      i++;
    } else if (a === '--live') {
      mode = 'live';
    } else if (a === '--limit' && next) {
      limit = Math.max(1, Math.min(50, Number(next)));
      i++;
    } else if (a === '--lead-id' && next) {
      leadId = next;
      i++;
    }
  }

  if (!lang) {
    console.error(
      'Usage:\n' +
        '  pnpm tsx scripts/send-cold-batch.ts --lang fr --dry-run [--limit 3]\n' +
        '  pnpm tsx scripts/send-cold-batch.ts --lang fr --test-email YOU@gmail.com [--limit 3]\n' +
        '  pnpm tsx scripts/send-cold-batch.ts --lang fr --live [--limit 1]\n' +
        '\n' +
        'Options:\n' +
        '  --lang fr|en             Template language + lead.language filter.\n' +
        '  --variant agency|merchant  Restrict to one population. Default: auto\n' +
        '                           (derive per-lead from lead.platform).\n' +
        '  --touch 1                Sequence step (only 1 in v1).\n' +
        '  --limit N                Max sends per run (default 1, max 50).\n' +
        '  --lead-id <uuid>         Force a specific lead.\n' +
        '  --dry-run                Default. Render + print, no SMTP, no DB write.\n' +
        '  --test-email A           Send to A instead of the lead; no DB write.\n' +
        '  --live                   Send to the real lead; record attempt + flip status.\n'
    );
    process.exit(1);
  }
  if (mode === 'test-email' && !testEmail) {
    console.error('--test-email requires an address');
    process.exit(1);
  }
  return { mode, lang, touch, limit, testEmail, leadId, variant };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const { sendColdMail } = await import('@/features/cold-outreach');
  const { renderColdMail, firstNameFromEmail, agencyNameFromDomain } =
    await import('@/features/cold-outreach');
  type ScoreSnapshot = import('@/features/cold-outreach').ScoreSnapshot;
  const { platformDisplayName } = await import('@/features/cold-outreach');

  // Localised labels for the score grid + stats hook. Matches the
  // labels we use on the dashboard / audit page so the cold mail
  // reads consistently with the in-product UI.
  const SCORE_LABELS: Record<'fr' | 'en', ScoreSnapshot['labels']> = {
    fr: {
      overall: 'Score global',
      catalog: 'Catalogue',
      copy: 'Copy',
      visual: 'Visuel',
      tagging: 'Tags'
    },
    en: { overall: 'Overall', catalog: 'Catalog', copy: 'Copy', visual: 'Visual', tagging: 'Tags' }
  };
  const { makeOptOutToken } = await import('@/features/cold-outreach');
  const { db } = await import('@/lib/db');
  const { audits, leads, leadAttempts } = await import('@/lib/db/schema');
  const { and, desc, eq, isNotNull, isNull, inArray, sql, or } = await import('drizzle-orm');
  const { randomUUID } = await import('node:crypto');

  // Two-step classification:
  //   1) is this a merchant (auditable) or an agency (unknown)?
  //   2) for merchants, do we have ANY completed audit for the domain?
  // The "is this even worth mailing" check uses platform only — the
  // audit's mere existence decides which merchant template wins.
  //
  // No freshness window: product catalogs barely change, so we reuse the
  // most recent completed audit regardless of age rather than re-auditing
  // before every campaign. (Was a 24h cutoff — dropped per operator.)

  const platformCategory = (platform: string): 'merchant' | 'agency' | null => {
    if (platform === 'shopify' || platform === 'woocommerce' || platform === 'wix') {
      return 'merchant';
    }
    if (platform === 'unknown') return 'agency';
    return null;
  };

  interface AuditScoresJson {
    overall: number;
    catalogCompleteness: number;
    copyQuality: number;
    visualQuality: number;
    taggingQuality: number;
  }
  interface AuditSummaryJson {
    distribution?: {
      imagesZero?: number;
      descEmpty?: number;
      tagsZero?: number;
    };
    allProducts?: unknown[];
  }
  interface FreshAudit {
    token: string;
    scores: AuditScoresJson | null;
    summary: AuditSummaryJson | null;
    productsSampled: number | null;
  }

  /** Returns the latest completed anon audit for a domain (any age),
   *  including scores + summary so the cold mail can embed the score grid
   *  + stats hook. No freshness window — catalogs barely change, so a
   *  weeks-old audit is still a valid hook and avoids re-auditing before
   *  every campaign.
   *
   *  Two-step (mirrors claimAnonAudits in src/lib/anon.ts): pull the
   *  most-recent id with a tiny projection so the ORDER BY sort buffer
   *  doesn't have to carry the multi-MB `summary` JSON. Then fetch the
   *  payload columns on the resolved id. Without the split, MySQL
   *  raises ER_OUT_OF_SORTMEMORY on audits with rich summaries. */
  async function latestAuditForDomain(domain: string): Promise<FreshAudit | null> {
    const idRow = await db
      .select({ id: audits.id })
      .from(audits)
      .where(
        and(
          isNull(audits.projectId),
          isNotNull(audits.anonToken),
          eq(audits.domain, domain),
          eq(audits.status, 'completed')
        )
      )
      .orderBy(desc(audits.createdAt))
      .limit(1);
    if (idRow.length === 0) return null;

    const row = await db.query.audits.findFirst({
      where: eq(audits.id, idRow[0].id),
      columns: {
        anonToken: true,
        scores: true,
        summary: true,
        productsSampled: true
      }
    });
    if (!row?.anonToken) return null;
    return {
      token: row.anonToken,
      scores: (row.scores as AuditScoresJson | null) ?? null,
      summary: (row.summary as AuditSummaryJson | null) ?? null,
      productsSampled: row.productsSampled ?? null
    };
  }

  // Discover the candidate leads. We want lead.language to match the
  // template language (or NULL for EN as a safety fallback) AND a
  // contactEmail to actually exist. The auto-picker also excludes leads
  // that already have any email attempt — re-runs of --live should not
  // double-send the same touch.
  let candidates: Array<{
    id: string;
    domain: string;
    contactEmail: string | null;
    language: string | null;
    platform: string;
  }> = [];

  if (args.leadId) {
    const row = await db.query.leads.findFirst({
      where: eq(leads.id, args.leadId),
      columns: { id: true, domain: true, contactEmail: true, language: true, platform: true }
    });
    if (!row) {
      console.error(`Lead ${args.leadId} not found`);
      process.exit(1);
    }
    candidates = [row];
  } else {
    const langPredicate =
      args.lang === 'fr'
        ? eq(leads.language, 'fr')
        : // EN bucket: leads with lang='en' or NULL (unknown defaults to EN)
          sql`(${leads.language} = 'en' OR ${leads.language} IS NULL)`;

    // Variant filter at SQL level when the operator pinned one — saves
    // pulling rows we'd drop anyway.
    const variantPredicate =
      args.variant === 'agency'
        ? eq(leads.platform, 'unknown')
        : args.variant === 'merchant'
          ? or(
              eq(leads.platform, 'shopify'),
              eq(leads.platform, 'woocommerce'),
              eq(leads.platform, 'wix')
            )
          : undefined;

    const whereClauses = [eq(leads.status, 'new'), isNotNull(leads.contactEmail), langPredicate];
    if (variantPredicate) whereClauses.push(variantPredicate);

    // Exclude role/privacy/abuse mailboxes at the SQL level so we never
    // even pull them as candidates. The send loop hard-skips them too,
    // as a backstop for local-part variants and the --lead-id override.
    for (const lp of SENSITIVE_LOCALPARTS) {
      whereClauses.push(sql`LOWER(${leads.contactEmail}) NOT LIKE ${`${lp}@%`}`);
    }

    const rows = await db
      .select({
        id: leads.id,
        domain: leads.domain,
        contactEmail: leads.contactEmail,
        language: leads.language,
        platform: leads.platform
      })
      .from(leads)
      .where(and(...whereClauses))
      .limit(args.limit * 4);

    // Quality-filter BEFORE slicing to --limit so junk leads don't eat
    // send slots (they used to be skipped inside the loop, shrinking a
    // 20-mail batch to 15). The loop keeps the same checks as a
    // backstop for the --lead-id path.
    const clean = rows.filter(
      (r) =>
        r.contactEmail &&
        !isSensitiveAddress(r.contactEmail) &&
        isValidContactEmail(r.contactEmail) &&
        !isPlaceholderAddress(r.contactEmail) &&
        !isGibberishMyshopify(r.domain)
    );
    if (clean.length < rows.length) {
      console.log(
        `[send-cold-batch] pre-filtered ${rows.length - clean.length} junk lead(s) (role/malformed/placeholder/gibberish-myshopify)`
      );
    }

    // In live mode, drop anything that already has a recorded attempt.
    // In dry-run / test-email modes, leave them in so the operator can
    // preview the same lead repeatedly.
    if (args.mode === 'live' && clean.length > 0) {
      const ids = clean.map((r) => r.id);
      const attempted = await db
        .select({ leadId: leadAttempts.leadId })
        .from(leadAttempts)
        .where(and(inArray(leadAttempts.leadId, ids), eq(leadAttempts.channel, 'email')));
      const attemptedSet = new Set(attempted.map((a) => a.leadId));
      candidates = clean.filter((r) => !attemptedSet.has(r.id)).slice(0, args.limit);
    } else {
      candidates = clean.slice(0, args.limit);
    }
  }

  if (candidates.length === 0) {
    console.log('[send-cold-batch] No candidates matched. Exiting.');
    return;
  }

  console.log(
    `[send-cold-batch] mode=${args.mode} lang=${args.lang} touch=${args.touch} candidates=${candidates.length}`
  );

  const fromName = process.env.COLD_SMTP_FROM_NAME ?? 'Youbi';
  const auditBase = (process.env.COLD_AUDIT_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');
  // Origin of the public unsubscribe handler. The locale prefix and
  // `?t=` are appended below per-lead. Hosted on the main app
  // (oneshoplab.com) so the existing Next.js + nginx infra serves it
  // and the cold operator doesn't have to maintain a separate vhost.
  const optOutBase = (process.env.COLD_OPTOUT_BASE_URL ?? 'https://oneshoplab.com').replace(
    /\/$/,
    ''
  );
  // Discord invite — reuses the site's NEXT_PUBLIC variable since the
  // cold sender lives in the same repo and the invite link is the same
  // surface (community / direct chat). Falls back to a placeholder so
  // missing env doesn't crash a dry-run.
  const discordUrl = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? 'https://discord.gg/oneshoplab';

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i];
    if (!lead.contactEmail) continue;

    // Hard backstop (covers --lead-id + local-part variants the SQL
    // NOT LIKE wouldn't catch). Never mail a role/privacy/abuse mailbox,
    // a malformed address (bounce risk), or a scraper placeholder.
    let skipReason: string | null = null;
    if (isSensitiveAddress(lead.contactEmail)) skipReason = 'role/privacy mailbox';
    else if (!isValidContactEmail(lead.contactEmail)) skipReason = 'malformed email';
    else if (isPlaceholderAddress(lead.contactEmail)) skipReason = 'placeholder email';
    else if (isGibberishMyshopify(lead.domain)) skipReason = 'gibberish myshopify domain';
    if (skipReason) {
      console.log(
        `\n[${i + 1}/${candidates.length}] ${lead.domain}  (skipped: ${skipReason} ${lead.contactEmail})`
      );
      continue;
    }

    const category = platformCategory(lead.platform);
    if (!category) {
      console.log(
        `\n[${i + 1}/${candidates.length}] ${lead.domain}  (skipped: no template for platform=${lead.platform})`
      );
      continue;
    }

    // For merchants, look up a fresh pre-run audit. Found → audited
    // variant with /audit/{token} URL + score grid. Not found →
    // unaudited fallback pointing to the homepage (per operator
    // decision).
    let leadVariant: ColdVariant;
    let auditUrl: string;
    let scoreSnapshot: ScoreSnapshot | undefined;
    let scoreOverall = '0';
    let stats = { audited: '0', noImage: '0', noDesc: '0', noTags: '0' };

    if (category === 'agency') {
      leadVariant = 'agency';
      auditUrl = `${auditBase}/?utm_source=cold&utm_medium=email&utm_campaign=agency_t1_${args.lang}&lead=${lead.id}`;
    } else {
      const fresh = await latestAuditForDomain(lead.domain);
      if (fresh && fresh.scores) {
        leadVariant = 'merchant_audited';
        auditUrl = `${auditBase}/${args.lang}/audit/${fresh.token}?utm_source=cold&utm_medium=email&utm_campaign=merchant_audited_t1_${args.lang}&lead=${lead.id}`;
        scoreOverall = String(Math.round(fresh.scores.overall));
        scoreSnapshot = {
          overall: Math.round(fresh.scores.overall),
          catalog: Math.round(fresh.scores.catalogCompleteness),
          copy: Math.round(fresh.scores.copyQuality),
          visual: Math.round(fresh.scores.visualQuality),
          tagging: Math.round(fresh.scores.taggingQuality),
          labels: SCORE_LABELS[args.lang]
        };
        const dist = fresh.summary?.distribution ?? {};
        const total = fresh.summary?.allProducts?.length ?? fresh.productsSampled ?? 0;
        stats = {
          audited: String(total),
          noImage: String(dist.imagesZero ?? 0),
          noDesc: String(dist.descEmpty ?? 0),
          noTags: String(dist.tagsZero ?? 0)
        };
      } else {
        leadVariant = 'merchant_unaudited';
        auditUrl = `${auditBase}/?utm_source=cold&utm_medium=email&utm_campaign=merchant_unaudited_t1_${args.lang}&lead=${lead.id}`;
      }
    }

    const firstName =
      firstNameFromEmail(lead.contactEmail) ?? (args.lang === 'fr' ? "l'équipe" : 'team');
    const displayName = agencyNameFromDomain(lead.domain);
    const optOutUrl = `${optOutBase}/${args.lang}/unsubscribe?t=${makeOptOutToken(lead.id)}`;

    const rendered =
      leadVariant === 'agency'
        ? renderColdMail('agency', args.lang, args.touch, {
            firstName,
            agencyName: displayName,
            auditUrl,
            discordUrl,
            optOutUrl,
            fromName
          })
        : renderColdMail(
            leadVariant,
            args.lang,
            args.touch,
            {
              firstName,
              storeName: displayName,
              platformDisplay: platformDisplayName(lead.platform),
              auditUrl,
              discordUrl,
              optOutUrl,
              fromName,
              scoreOverall,
              productsAudited: stats.audited,
              productsNoImage: stats.noImage,
              productsNoDesc: stats.noDesc,
              productsNoTags: stats.noTags
            },
            scoreSnapshot
          );

    const recipient = args.mode === 'test-email' ? args.testEmail! : lead.contactEmail;

    const header = `\n[${i + 1}/${candidates.length}] ${lead.domain}  →  ${recipient}`;
    console.log(header);
    console.log(`  subject: ${rendered.subject}`);
    if (args.mode === 'dry-run') {
      console.log('  --- text ---');
      console.log(
        rendered.text
          .split('\n')
          .map((l) => `  | ${l}`)
          .join('\n')
      );
      sent += 1;
      continue;
    }

    const result = await sendColdMail({
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      listUnsubscribe: `<${optOutUrl}>, <mailto:${process.env.COLD_SMTP_FROM_EMAIL ?? 'contact@get-oneshoplab.com'}?subject=unsubscribe>`
    });

    if (!result.ok) {
      console.error(`  ✗ FAILED: ${result.reason}`);
      failed += 1;
      continue;
    }

    console.log(`  ✓ sent (messageId=${result.messageId ?? 'n/a'})`);
    sent += 1;

    // Live mode: record + flip status. Test-email mode never touches DB
    // because the real prospect was never contacted.
    if (args.mode === 'live') {
      await db.insert(leadAttempts).values({
        id: randomUUID(),
        leadId: lead.id,
        channel: 'email',
        payload: JSON.stringify({
          subject: rendered.subject,
          touch: args.touch,
          lang: args.lang,
          variant: leadVariant
        }),
        response: null
      });
      await db
        .update(leads)
        .set({ status: 'contacted', lastAttemptedAt: new Date() })
        .where(eq(leads.id, lead.id));
    }

    // Human-ish jitter between sends. Skip on the last one + skip in
    // test-email mode (you don't need pacing when it's all going to you).
    if (args.mode === 'live' && i < candidates.length - 1) {
      const pauseMs = 30_000 + Math.floor(Math.random() * 30_000);
      console.log(`  (sleeping ${Math.round(pauseMs / 1000)}s before next)`);
      await sleep(pauseMs);
    }
  }

  console.log(`\n[send-cold-batch] done. sent=${sent} failed=${failed}`);
}

// Force a clean exit: nodemailer's SMTP transport keeps an idle socket
// open after the last send, which keeps Node's event loop alive so the
// process would otherwise hang indefinitely once all mails are sent (and,
// in live mode, all DB writes committed). main() awaits every send before
// resolving, so exiting here can't truncate an in-flight message.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
