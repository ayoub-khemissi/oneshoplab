/**
 * Lead hygiene for cold outreach — extracted verbatim from
 * scripts/send-cold-batch.ts so it can be unit-tested. Every filter here
 * exists because of a real incident (see comments); loosen with care.
 */
// Role / privacy / abuse mailboxes we must NEVER cold-mail. These reach a
// company's data-protection, legal or abuse desk — not the buyer — so a
// cold pitch landing there is the fastest route to a CNIL complaint or a
// spam report (which torches sender reputation). Generic business inboxes
// (info@, contact@, hello@, sales@) are fine and intentionally NOT listed.
export const SENSITIVE_LOCALPARTS = [
  'rgpd',
  'dpo',
  'privacy',
  'datenschutz',
  'abuse',
  'postmaster',
  'hostmaster',
  'webmaster',
  'legal',
  'compliance',
  'security',
  'noc',
  'no-reply',
  'noreply',
  'donotreply',
  'mailer-daemon'
];

/** True when an email's local part is (or begins with) a sensitive role
 *  mailbox — matches `rgpd@`, `dpo.xx@`, `legal-team@`, `privacy_…@`, etc. */
export function isSensitiveAddress(email: string): boolean {
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  return SENSITIVE_LOCALPARTS.some(
    (lp) =>
      local === lp ||
      local.startsWith(`${lp}.`) ||
      local.startsWith(`${lp}-`) ||
      local.startsWith(`${lp}_`) ||
      local.startsWith(`${lp}+`)
  );
}

// Obvious scraper placeholders — a scrape that couldn't find a real
// contact sometimes drops a "Mr Smith" stand-in. Mailing these hits an
// uninvolved stranger (spam complaint) or nobody at all.
const PLACEHOLDER_LOCALPARTS = [
  'jean.dupont',
  'jean.dupond',
  'john.doe',
  'johndoe',
  'jane.doe',
  'nom.prenom',
  'prenom.nom',
  'votre.email',
  'your.email',
  'user',
  'test',
  'example',
  'demo'
];

export function isPlaceholderAddress(email: string): boolean {
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  return PLACEHOLDER_LOCALPARTS.includes(local);
}

/** Digit-bearing *.myshopify.com subdomains (02e96b, 0ymzia-df, …) are
 *  dev/test/staging stores, not brands: the derived store name renders
 *  as gibberish in the subject ("quick notes on 02e96b Myshopify"),
 *  which reads as spam, and their scraped contacts are unreliable
 *  (one resolved to a UK university address). Brand-named myshopify
 *  canonical domains (burlebo.myshopify.com) carry no digit and pass. */
export function isGibberishMyshopify(domain: string): boolean {
  const m = domain.toLowerCase().match(/^([a-z0-9-]+)\.myshopify\.com$/);
  return m !== null && /\d/.test(m[1]);
}

/** Basic structural validity — rejects malformed scrapes like `/@dom.fr`
 *  (local part with no alphanumeric), missing TLD, double dots, multi-@.
 *  A hard bounce on a young sending domain hurts reputation badly, so we
 *  drop anything that doesn't look deliverable rather than risk it. */
export function isValidContactEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.indexOf('@');
  if (at < 1) return false;
  if (e.indexOf('@', at + 1) !== -1) return false; // more than one @
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  // Practical local-part charset only — rejects scraped URLs (slashes,
  // spaces) like `//www.tiktok.com/` that are technically RFC-valid but
  // never a real mailbox.
  if (!/^[a-z0-9._%+'-]+$/.test(local)) return false;
  if (!/[a-z0-9]/.test(local)) return false; // local must hold an alnum
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false; // dotted domain + TLD
  if (e.includes('..')) return false;
  return true;
}
