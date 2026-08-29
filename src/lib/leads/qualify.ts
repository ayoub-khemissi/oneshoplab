import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { detectPlatform } from '@/lib/adapters';
import { db } from '@/lib/db';
import { leads, type LeadStatus } from '@/lib/db/schema';
import { extractContactInfo } from './contact-scraper';
import { isBlockedDomain } from './discovery';

/**
 * Outcome of a single qualification pass on one URL. The caller is
 * expected to persist the row via `upsertQualifiedLead` when status
 * is 'qualified' — the standalone shape stays serialisable for
 * logging / CLI output.
 */
export type QualifyOutcome =
  | {
      status: 'qualified';
      domain: string;
      url: string;
      platform: 'shopify' | 'woocommerce' | 'wix';
      productsSampled: number;
      language: string | null;
      country: string | null;
      contactEmail: string | null;
      contactSocials: string[];
    }
  | {
      status: 'skip';
      domain: string;
      reason: 'platform_not_detected';
      /** Carries the fetched HTML + final URL forward so a caller can
       *  run a second-pass detector (alt-platforms like Magento /
       *  PrestaShop / …) without re-hitting the merchant's server. */
      finalUrl?: string;
      homeHtml?: string;
    }
  | { status: 'skip'; domain: string; reason: 'no_products_fetched' }
  | { status: 'skip'; domain: string; reason: 'manual_or_unknown' }
  | { status: 'skip'; domain: string; reason: 'blocked_domain' }
  | { status: 'error'; domain: string; reason: string };

const HTML_LANG_RE = /<html[^>]*\blang=["']([a-z]{2})/i;

export function detectLanguage(html: string): string | null {
  const m = html.match(HTML_LANG_RE);
  return m ? m[1].toLowerCase() : null;
}

function safeHost(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  }
}

/**
 * Try to qualify a candidate merchant URL. Returns an outcome object
 * describing whether the site is eligible for OneShopLab (we can
 * detect the platform AND fetch at least one product). Pure — does
 * NOT touch the DB; persistence is handled by `upsertQualifiedLead`.
 *
 * Why we don't bail at the platform-detect step and call
 * `fetchProducts` even when detection returned "unknown": detection
 * sometimes mis-scores a shop (e.g. Shopify storefronts behind
 * caching/CDN can starve the home-page signals) but the adapter's
 * dedicated probe inside `fetchProducts` still finds products via
 * `/products.json`. For prospection v1 we trust the original
 * detection — if the catalog API is closed, we have nothing to sell
 * OneShopLab on anyway.
 */
export async function qualifyUrl(rawUrl: string): Promise<QualifyOutcome> {
  const url = rawUrl.trim();
  if (!url) return { status: 'error', domain: '', reason: 'empty_url' };

  const domain = safeHost(url);
  if (!domain) return { status: 'error', domain: url, reason: 'invalid_url' };

  // Defence-in-depth: discovery providers already filter blocked
  // domains, but a manual seed paste from the admin UI bypasses
  // that. Skip here so the operator doesn't waste a fetch on a known
  // non-shop (Shopify support, reddit, etc.).
  if (isBlockedDomain(domain)) {
    return { status: 'skip', domain, reason: 'blocked_domain' };
  }

  let detection;
  try {
    detection = await detectPlatform(url);
  } catch (e) {
    return {
      status: 'error',
      domain,
      reason: `detect_failed:${(e as Error).message}`
    };
  }

  const { adapter, finalUrl, homeHtml } = detection;
  if (
    !adapter ||
    detection.detection.platform === 'unknown' ||
    detection.detection.platform === 'manual'
  ) {
    return {
      status: 'skip',
      domain,
      reason: 'platform_not_detected',
      finalUrl,
      homeHtml
    };
  }

  // Pull a single product to confirm the catalog endpoint is open.
  // Anything more would slow discovery without adding signal.
  let products = 0;
  let firstProduct: { title: string } | null = null;
  try {
    for await (const p of adapter.fetchProducts(
      { url: finalUrl, homeHtml },
      { maxProducts: 1 }
    )) {
      products += 1;
      firstProduct = { title: p.title };
      break;
    }
  } catch (e) {
    return { status: 'error', domain, reason: `fetch_failed:${(e as Error).message}` };
  }
  if (products === 0 || !firstProduct) {
    return { status: 'skip', domain, reason: 'no_products_fetched' };
  }

  // Contact info is best-effort: a Wix or JS-rendered site might
  // give nothing — we still want the lead in the table so the
  // operator can chase the contact manually.
  const contact = await extractContactInfo(finalUrl).catch(() => ({
    email: null,
    socials: [] as string[]
  }));

  return {
    status: 'qualified',
    domain,
    url: finalUrl,
    platform: adapter.name as 'shopify' | 'woocommerce' | 'wix',
    productsSampled: products,
    language: detectLanguage(homeHtml),
    country: null, // future: enrich via Shopify shop API, Wix locale meta, etc.
    contactEmail: contact.email,
    contactSocials: contact.socials
  };
}

/**
 * Insert or update a qualified lead, keyed on `domain`. Re-qualifying
 * an existing lead refreshes platform / contact info but never
 * downgrades a status the operator has already moved past 'new'
 * (we don't want a re-run of the discovery worker to overwrite a
 * 'won' lead back to 'new').
 */
export async function upsertQualifiedLead(
  outcome: Extract<QualifyOutcome, { status: 'qualified' }>,
  meta: { discoveredVia: string | null }
): Promise<{ id: string; created: boolean }> {
  const existing = await db.query.leads.findFirst({
    where: eq(leads.domain, outcome.domain),
    columns: { id: true, status: true }
  });

  if (existing) {
    await db
      .update(leads)
      .set({
        url: outcome.url,
        platform: outcome.platform,
        productsSampled: outcome.productsSampled,
        language: outcome.language,
        country: outcome.country,
        contactEmail: outcome.contactEmail,
        contactSocials: outcome.contactSocials,
        qualifiedAt: new Date()
      })
      .where(eq(leads.id, existing.id));
    return { id: existing.id, created: false };
  }

  const id = randomUUID();
  await db.insert(leads).values({
    id,
    domain: outcome.domain,
    url: outcome.url,
    platform: outcome.platform,
    productsSampled: outcome.productsSampled,
    language: outcome.language,
    country: outcome.country,
    contactEmail: outcome.contactEmail,
    contactSocials: outcome.contactSocials,
    status: 'new' satisfies LeadStatus,
    discoveredVia: meta.discoveredVia,
    qualifiedAt: new Date()
  });
  return { id, created: true };
}

/**
 * Upsert a NON-store lead (agency, freelancer, anyone we only want for
 * the contact). No store qualification — platform stays 'unknown',
 * productsSampled 0, qualifiedAt null. Same `leads` table + admin CRM
 * as merchant leads, so outreach/status tracking is unified. Refreshes
 * contact info on re-runs without resetting an operator's status.
 */
export async function upsertContactLead(input: {
  domain: string;
  url: string;
  email: string | null;
  socials: string[];
  discoveredVia: string | null;
}): Promise<{ id: string; created: boolean; hasEmail: boolean }> {
  const existing = await db.query.leads.findFirst({
    where: eq(leads.domain, input.domain),
    columns: { id: true }
  });
  if (existing) {
    await db
      .update(leads)
      .set({
        url: input.url,
        contactEmail: input.email,
        contactSocials: input.socials
      })
      .where(eq(leads.id, existing.id));
    return { id: existing.id, created: false, hasEmail: !!input.email };
  }
  const id = randomUUID();
  await db.insert(leads).values({
    id,
    domain: input.domain,
    url: input.url,
    platform: 'unknown',
    productsSampled: 0,
    language: null,
    country: null,
    contactEmail: input.email,
    contactSocials: input.socials,
    status: 'new' satisfies LeadStatus,
    discoveredVia: input.discoveredVia
  });
  return { id, created: true, hasEmail: !!input.email };
}

/**
 * Upsert a merchant lead running on a platform our auto-audit pipeline
 * doesn't speak natively (Magento / PrestaShop / BigCommerce /
 * Squarespace). We store the real detected platform in `notes` so the
 * operator can grep / filter, while `platform` stays 'manual' — the
 * enum doesn't carry the alt-platform values and we want to avoid a
 * migration for a discovery surface that's still experimental.
 *
 * Idempotent on `domain`: re-runs refresh contact info + notes
 * without overwriting operator-set status (e.g. don't reset 'replied'
 * back to 'new').
 */
export async function upsertManualMerchantLead(input: {
  domain: string;
  url: string;
  detectedPlatform: string;
  language: string | null;
  email: string | null;
  socials: string[];
  discoveredVia: string | null;
}): Promise<{ id: string; created: boolean; hasEmail: boolean }> {
  const notes = `detected:${input.detectedPlatform}`;
  const existing = await db.query.leads.findFirst({
    where: eq(leads.domain, input.domain),
    columns: { id: true }
  });
  if (existing) {
    await db
      .update(leads)
      .set({
        url: input.url,
        contactEmail: input.email,
        contactSocials: input.socials,
        notes,
        language: input.language
      })
      .where(eq(leads.id, existing.id));
    return { id: existing.id, created: false, hasEmail: !!input.email };
  }
  const id = randomUUID();
  await db.insert(leads).values({
    id,
    domain: input.domain,
    url: input.url,
    platform: 'manual',
    productsSampled: 0,
    language: input.language,
    country: null,
    contactEmail: input.email,
    contactSocials: input.socials,
    notes,
    status: 'new' satisfies LeadStatus,
    discoveredVia: input.discoveredVia
  });
  return { id, created: true, hasEmail: !!input.email };
}

export interface BatchSummary {
  total: number;
  qualified: number;
  created: number;
  skipped: number;
  errored: number;
  byPlatform: Record<string, number>;
  failures: Array<{ domain: string; reason: string }>;
}

/**
 * Walk a list of candidate URLs with bounded concurrency. Each URL
 * hits its own merchant, so different hosts can be qualified in
 * parallel safely; the cap (default 5) prevents thrashing our own
 * Node event loop on a wide list. Same-host coalescing isn't needed
 * because we dedupe domains upfront.
 */
export async function qualifyBatch(
  urls: string[],
  discoveredVia: string | null,
  concurrency = 5
): Promise<BatchSummary> {
  const summary: BatchSummary = {
    total: urls.length,
    qualified: 0,
    created: 0,
    skipped: 0,
    errored: 0,
    byPlatform: {},
    failures: []
  };

  // Pre-dedupe so the queue only carries one URL per host.
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const u of urls) {
    const trimmed = u.trim();
    if (!trimmed) continue;
    const dom = safeHost(trimmed);
    if (seen.has(dom)) continue;
    seen.add(dom);
    queue.push(trimmed);
  }
  summary.total = queue.length;

  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const url = queue[idx];
      const outcome = await qualifyUrl(url);
      if (outcome.status === 'qualified') {
        const r = await upsertQualifiedLead(outcome, { discoveredVia });
        summary.qualified += 1;
        if (r.created) summary.created += 1;
        summary.byPlatform[outcome.platform] =
          (summary.byPlatform[outcome.platform] ?? 0) + 1;
      } else if (outcome.status === 'skip') {
        summary.skipped += 1;
        summary.failures.push({ domain: outcome.domain, reason: outcome.reason });
      } else {
        summary.errored += 1;
        summary.failures.push({ domain: outcome.domain, reason: outcome.reason });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker)
  );

  return summary;
}
