import { fetchText, rootOf } from '@/lib/adapters/fetch-utils';

/**
 * Lightweight contact extractor for prospection.
 *
 * Walks a small set of likely-to-carry-contact-info pages and returns
 * the best-guess primary email + a deduped list of social URLs.
 * Plain `fetch` only — no puppeteer — so JS-rendered Wix shops won't
 * yield much, which is fine for v1 (we still record the lead, just
 * without an email).
 *
 * Why a hand-rolled regex instead of importing tools/email-scraper:
 * that tool ships its own package.json (puppeteer, csv-stringify) and
 * CLAUDE.md explicitly tells us not to merge it into the main app's
 * deps. The 30-line subset we need is trivial to inline.
 */

const EMAIL_RE =
  /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+/g;

const EMAIL_JUNK: RegExp[] = [
  /\.(?:png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot)$/i,
  /sentry/i,
  /webpack/i,
  /example\.com$/i,
  /^test@/i,
  /^noreply@/i,
  /^no-reply@/i,
  /@wix\.com$/i,
  /@shopify\.com$/i,
  /@wordpress\.\w+$/i,
  /@wp\.\w+$/i,
  /@your-?domain/i,
  /@yourstore/i,
  /@change\.me/i
];

const SOCIAL_HOSTS = [
  'instagram.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'linkedin.com',
  'youtube.com',
  'pinterest.com'
];

// Contact-page conventions across platforms. Tried in order; we stop
// as soon as a 200 response yields at least one valid email — or
// after the last path if none did.
const CONTACT_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/pages/contact',
  '/pages/contact-us',
  '/about',
  '/about-us'
];

function isPlausibleEmail(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a.length > 254) return false;
  if (EMAIL_JUNK.some((re) => re.test(a))) return false;
  return true;
}

function extractEmails(html: string): string[] {
  const seen = new Set<string>();
  // Cheap mailto: pass first — mailto links are the strongest signal
  // ("the merchant put this on their page on purpose"), so we keep
  // them ahead of free-text matches.
  for (const m of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    const a = m[1]!.trim().toLowerCase();
    if (isPlausibleEmail(a)) seen.add(a);
  }
  for (const m of html.matchAll(EMAIL_RE)) {
    const a = m[0].trim().toLowerCase();
    if (isPlausibleEmail(a)) seen.add(a);
  }
  return [...seen];
}

function extractSocials(html: string, ownDomain: string): string[] {
  const seen = new Set<string>();
  // Match href values pointing at known social hosts. We accept query
  // strings and trailing slashes; we drop the merchant's own domain
  // so a relative link doesn't leak through.
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const raw = m[1];
    if (!raw) continue;
    let parsed: URL | null = null;
    try {
      parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw, `https://${ownDomain}`);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === ownDomain.replace(/^www\./, '')) continue;
    if (!SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) continue;
    // Strip trackers — utm_*, fbclid, igshid — we want clean links.
    parsed.search = '';
    seen.add(parsed.toString());
    if (seen.size >= 8) break;
  }
  return [...seen];
}

export interface ContactExtractionResult {
  email: string | null;
  socials: string[];
}

/**
 * Try a handful of likely-contact-bearing paths and merge the
 * results. Returns the first email found (in mailto-priority order),
 * and the union of social URLs across all pages we hit.
 */
export async function extractContactInfo(
  url: string
): Promise<ContactExtractionResult> {
  const root = rootOf(url);
  const ownHost = new URL(root).hostname;
  const allEmails: string[] = [];
  const allSocials = new Set<string>();

  for (const path of CONTACT_PATHS) {
    const res = await fetchText(`${root}${path}`);
    if (!res.ok || !res.body) continue;

    const emails = extractEmails(res.body);
    for (const e of emails) {
      if (!allEmails.includes(e)) allEmails.push(e);
    }
    for (const s of extractSocials(res.body, ownHost)) allSocials.add(s);

    if (allEmails.length > 0 && allSocials.size >= 3) break;
  }

  // Prefer an email that matches the merchant's own domain — that's
  // their real contact address, not a Shopify support proxy.
  const ownDomainEmail = allEmails.find((e) => {
    const at = e.lastIndexOf('@');
    if (at < 0) return false;
    const domain = e.slice(at + 1);
    return ownHost.toLowerCase().endsWith(domain);
  });

  return {
    email: ownDomainEmail ?? allEmails[0] ?? null,
    socials: [...allSocials]
  };
}
