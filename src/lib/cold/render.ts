import {
  getTemplate,
  type ColdLang,
  type ColdTouch,
  type ColdVariant,
  type ColdVars
} from './templates';

/**
 * Substitute variables into a template and produce both text/plain and
 * text/html parts. The HTML version is generated from the text by
 * paragraph-splitting on blank lines and turning lines that start with
 * "- " into a <ul>. We don't accept HTML in the templates themselves —
 * plain text is signal-positive for deliverability (some spam filters
 * down-weight HTML-only mail) and a single source of truth is easier
 * to audit.
 *
 * Throws if any required variable is missing — better to fail loud at
 * dev time than to ship "Hi {firstName}" to a prospect.
 */

export interface RenderedColdMail {
  subject: string;
  text: string;
  html: string;
}

export function renderColdMail(
  variant: ColdVariant,
  lang: ColdLang,
  touch: ColdTouch,
  vars: ColdVars
): RenderedColdMail {
  const tpl = getTemplate(variant, lang, touch);
  const dict = vars as unknown as Record<string, string>;
  const subject = substitute(tpl.subject, dict);
  // Substitute variables first; CTA/LINK markers are kept as-is so the
  // text and HTML renderers can interpret them differently.
  const substituted = substitute(tpl.body, dict);
  const text = markersToText(substituted);
  const html = textToHtml(substituted);
  return { subject, text, html };
}

/**
 * Strip the [[CTA …]] / [[LINK …]] / [[DISCORD …]] markers for the
 * plain-text part. In text/plain the URL must be visible because the
 * user has no hover/click target — we render it as "label: URL". This
 * is also the version SpamAssassin reads for link analysis, so keeping
 * URLs inline-canonical avoids "hidden link" red flags.
 */
function markersToText(s: string): string {
  return s
    .replace(/\[\[CTA\s+([^|]+)\|\s*([^\]]+)\]\]/g, (_, label: string, url: string) =>
      `${label.trim()}: ${url.trim()}`
    )
    .replace(/\[\[DISCORD\s+([^|]+)\|\s*([^\]]+)\]\]/g, (_, label: string, url: string) =>
      `${label.trim()}: ${url.trim()}`
    )
    .replace(/\[\[LINK\s+([^|]+)\|\s*([^\]]+)\]\]/g, (_, label: string, url: string) =>
      `${label.trim()} (${url.trim()})`
    );
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key];
    if (v === undefined || v === '') {
      throw new Error(`Missing cold-mail variable: ${key}`);
    }
    return v;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CTA_RE = /\[\[CTA\s+([^|]+)\|\s*([^\]]+)\]\]/g;
const LINK_RE = /\[\[LINK\s+([^|]+)\|\s*([^\]]+)\]\]/g;
const ACCENT = '#2563eb';
const DISCORD_BRAND = '#5865F2';

// We used to embed a Discord SVG via a data: URI, but Gmail (and most
// webmail clients) strip data URIs in <img> tags as a CSP/security
// policy, rendering a broken-image square. We could host a PNG, but
// pulling a remote image hurts deliverability (open-tracking risk) and
// adds a load on the marketing flow. The button keeps the Discord
// brand purple so recognition is preserved without an icon.

/**
 * HTML-escape a chunk AND turn three kinds of tokens into anchors in a
 * single pass:
 *   - [[LINK label | url]]  → inline <a>label</a>  (URL hidden)
 *   - bare http(s)://…      → <a>full URL</a>      (legacy fallback)
 * The naive `linkify(escapeHtml(p))` double-encodes `&` inside query
 * strings (`&` → `&amp;` → `&amp;amp;`) and breaks UTM params. We
 * tokenize, so text gets escaped, URLs get escaped exactly once.
 *
 * CTA markers are NOT handled here — they are extracted at the
 * paragraph level (a CTA is its own block, not inline text).
 */
function escapeAndLink(s: string): string {
  let out = '';
  let lastIdx = 0;
  // Single combined sweep over [[LINK …]] OR bare http(s) URL.
  const COMBINED = /\[\[LINK\s+([^|]+)\|\s*([^\]]+)\]\]|(https?:\/\/[^\s<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = COMBINED.exec(s)) !== null) {
    out += escapeHtml(s.slice(lastIdx, m.index));
    if (m[1] !== undefined && m[2] !== undefined) {
      // [[LINK label | url]] — anchor text is the label, URL hidden.
      const label = escapeHtml(m[1].trim());
      const url = escapeHtml(m[2].trim());
      out += `<a href="${url}" style="color:${ACCENT};text-decoration:underline">${label}</a>`;
    } else if (m[3] !== undefined) {
      const url = escapeHtml(m[3]);
      out += `<a href="${url}" style="color:${ACCENT};text-decoration:underline">${url}</a>`;
    }
    lastIdx = m.index + m[0].length;
  }
  out += escapeHtml(s.slice(lastIdx));
  return out;
}

/** Render a [[CTA label | url]] block as a centered styled button. */
function ctaButton(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return (
    `<div style="margin:24px 0;text-align:center">` +
    `<a href="${safeUrl}" style="display:inline-block;padding:12px 28px;background:${ACCENT};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;line-height:1.2">${safeLabel} →</a>` +
    `</div>`
  );
}

/**
 * Render a [[DISCORD label | url]] block as a centered Discord-branded
 * button. Text-only (no icon — see comment above DISCORD_BRAND) but
 * the purple background keeps the brand recognition.
 */
function discordButton(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return (
    `<div style="margin:20px 0;text-align:center">` +
    `<a href="${safeUrl}" style="display:inline-block;padding:11px 24px;background:${DISCORD_BRAND};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;line-height:1.2">${safeLabel} →</a>` +
    `</div>`
  );
}

function textToHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const blocks: string[] = [];
  // The footer block is the last paragraph that starts with "—" — we
  // render it smaller and grey so the RGPD notice doesn't fight the
  // main message visually.
  const footerIdx = paragraphs.findLastIndex((p) => /^—\s*\n/m.test(p) || p.startsWith('—\n'));

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const isFooter = i === footerIdx;

    // A whole paragraph that IS a single CTA / DISCORD marker → button block.
    const ctaMatch = p.trim().match(/^\[\[CTA\s+([^|]+)\|\s*([^\]]+)\]\]$/);
    if (ctaMatch) {
      blocks.push(ctaButton(ctaMatch[1].trim(), ctaMatch[2].trim()));
      continue;
    }
    const discordMatch = p.trim().match(/^\[\[DISCORD\s+([^|]+)\|\s*([^\]]+)\]\]$/);
    if (discordMatch) {
      blocks.push(discordButton(discordMatch[1].trim(), discordMatch[2].trim()));
      continue;
    }

    const lines = p.split('\n');
    const isList = lines.every((l) => /^- /.test(l));
    const isNumberedList = lines.every((l) => /^\d+\. /.test(l));

    const paraStyle = isFooter
      ? 'margin:24px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5'
      : 'margin:0 0 16px;line-height:1.6;color:#111827';

    if (isList && lines.length > 1) {
      const items = lines
        .map((l) => `<li style="margin-bottom:4px">${escapeAndLink(l.replace(/^- /, ''))}</li>`)
        .join('');
      blocks.push(`<ul style="margin:0 0 16px;padding-left:20px;color:#111827">${items}</ul>`);
    } else if (isNumberedList && lines.length > 1) {
      const items = lines
        .map((l) => `<li style="margin-bottom:4px">${escapeAndLink(l.replace(/^\d+\. /, ''))}</li>`)
        .join('');
      blocks.push(`<ol style="margin:0 0 16px;padding-left:20px;color:#111827">${items}</ol>`);
    } else {
      const html = escapeAndLink(p).replace(/\n/g, '<br>');
      blocks.push(`<p style="${paraStyle}">${html}</p>`);
    }
  }
  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#111827;max-width:580px;margin:0 auto;padding:8px 4px">` +
    blocks.join('') +
    `</div>`
  );
}

/**
 * Best-effort "firstName" from an email local part. Strips dots,
 * underscores and trailing digits, then title-cases the first word.
 *   "marie.dupont@…"  → "Marie"
 *   "j.smith@…"       → "J"
 *   "info@…"          → "Info"  ← caller should fall back to "bonjour"-less variant
 *   "contact@…"       → "Contact"
 * Returns null for generic mailboxes — the caller decides how to greet.
 */
export function firstNameFromEmail(email: string | null): string | null {
  if (!email) return null;
  const local = email.split('@')[0].toLowerCase();
  if (!local) return null;
  if (
    /^(info|infos|contact|contacts|hello|hi|bonjour|salut|sales|support|admin|office|team|talk|hey|rgpd|gdpr|dpo|privacy|noreply|no-reply|donotreply|press|media|careers|jobs|hr|recrutement|recruiting|billing|invoice|legal|webmaster|postmaster|abuse|service|services|client|clients|customer|customers|mail|email|enquiries|enquiry|inquiries|inquiry|ask|hola|holla)$/.test(local)
  ) {
    return null;
  }
  const word = local.split(/[._-]/)[0].replace(/\d+$/, '');
  if (!word) return null;
  return word[0].toUpperCase() + word.slice(1);
}

/**
 * Best-effort "agencyName" from a domain. Drops the TLD and
 * title-cases the parts split on `-` / `.`.
 *   "acme-studio.com"  → "Acme Studio"
 *   "shop.brand.io"    → "Shop Brand"
 */
export function agencyNameFromDomain(domain: string): string {
  const stripped = domain.replace(/^www\./, '').split('.').slice(0, -1).join(' ');
  return stripped
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
