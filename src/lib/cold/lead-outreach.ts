import { and, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits } from '@/lib/db/schema';
import { agencyNameFromDomain } from './render';
import { platformDisplayName } from './templates';
import {
  buildContactCopy,
  CONTACT_LANGS,
  pickContactLang,
  type ContactCopy,
  type ContactLang,
  type ContactVariant
} from './contact-form';

/**
 * Server-side: turn a lead row into ready-to-paste contact-form copy in
 * every supported language, picking the right variant (agency /
 * merchant_audited / merchant_unaudited) and threading the localized
 * audit URL + score.
 *
 * The admin leads page batches the fresh-audit lookup across the whole
 * page (one query, see freshAuditsByDomain) and passes the matching
 * entry in, so this stays a pure transform with no per-lead DB hit.
 */

const FRESH_AUDIT_MS = 24 * 60 * 60 * 1000;

export interface FreshAuditInfo {
  token: string;
  scoreOverall: number;
}

interface LeadLike {
  domain: string;
  platform: string;
  language: string | null;
  /** Carries `detected:<altPlatform>` for platform='manual' leads. */
  notes: string | null;
}

export interface LeadOutreach {
  variant: ContactVariant;
  variantLabel: string;
  primaryLang: ContactLang;
  copies: Record<ContactLang, ContactCopy>;
}

const VARIANT_LABELS: Record<ContactVariant, string> = {
  agency: 'Agence',
  merchant_audited: 'Marchand · audit prêt',
  merchant_unaudited: 'Marchand · sans audit'
};

/** Pretty platform label for a lead, reading the detected alt-platform
 *  out of notes for platform='manual' rows. */
function platformLabelFor(lead: LeadLike): string {
  if (lead.platform === 'manual' && lead.notes?.startsWith('detected:')) {
    const detected = lead.notes.slice('detected:'.length).trim();
    // Capitalize the first letter for display (magento → Magento).
    return detected.charAt(0).toUpperCase() + detected.slice(1);
  }
  return platformDisplayName(lead.platform);
}

/** Batch lookup: most-recent fresh (24h) completed anonymous audit per
 *  domain, returning token + overall score. One query for the whole
 *  page. */
export async function freshAuditsByDomain(
  domains: string[]
): Promise<Map<string, FreshAuditInfo>> {
  const out = new Map<string, FreshAuditInfo>();
  if (domains.length === 0) return out;
  const cutoff = new Date(Date.now() - FRESH_AUDIT_MS);
  const rows = await db
    .select({
      domain: audits.domain,
      token: audits.anonToken,
      scores: audits.scores,
      createdAt: audits.createdAt
    })
    .from(audits)
    .where(
      and(
        isNull(audits.projectId),
        isNotNull(audits.anonToken),
        eq(audits.status, 'completed'),
        gt(audits.createdAt, cutoff),
        inArray(audits.domain, domains)
      )
    )
    .orderBy(desc(audits.createdAt));
  // rows are newest-first; keep the first (most recent) per domain.
  for (const r of rows) {
    if (!r.token || out.has(r.domain)) continue;
    const scores = (r.scores as { overall?: number } | null) ?? null;
    const overall = typeof scores?.overall === 'number' ? Math.round(scores.overall) : 0;
    out.set(r.domain, { token: r.token, scoreOverall: overall });
  }
  return out;
}

export function buildLeadOutreach(
  lead: LeadLike,
  fresh: FreshAuditInfo | undefined,
  opts: { appUrl: string; discordUrl: string; fromName: string }
): LeadOutreach {
  const base = opts.appUrl.replace(/\/$/, '');
  const name = agencyNameFromDomain(lead.domain);
  const platformDisplay = platformLabelFor(lead);

  // Classify. Agencies (platform=unknown) → agency variant. Auto-
  // auditable merchants with a fresh audit → audited, otherwise
  // unaudited. platform='manual' (alt-platforms) can't be auto-
  // audited, so always unaudited.
  let variant: ContactVariant;
  if (lead.platform === 'unknown') {
    variant = 'agency';
  } else if (fresh) {
    variant = 'merchant_audited';
  } else {
    variant = 'merchant_unaudited';
  }

  const copies = {} as Record<ContactLang, ContactCopy>;
  for (const lang of CONTACT_LANGS) {
    // Audit URL is locale-prefixed on the app. Audited → the specific
    // report; otherwise the localized homepage so the prospect can run
    // their own audit.
    const auditUrl =
      variant === 'merchant_audited' && fresh
        ? `${base}/${lang}/audit/${fresh.token}?utm_source=contactform&utm_medium=manual&utm_campaign=${variant}_${lang}`
        : `${base}/${lang}?utm_source=contactform&utm_medium=manual&utm_campaign=${variant}_${lang}`;
    copies[lang] = buildContactCopy(variant, lang, {
      name,
      platformDisplay,
      auditUrl,
      discordUrl: opts.discordUrl,
      scoreOverall: String(fresh?.scoreOverall ?? 0),
      fromName: opts.fromName
    });
  }

  return {
    variant,
    variantLabel: VARIANT_LABELS[variant],
    primaryLang: pickContactLang(lead.language),
    copies
  };
}
