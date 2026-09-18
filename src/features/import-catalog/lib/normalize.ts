import sanitizeHtml from 'sanitize-html';
import { slugify } from '@/shared/lib/slugify';
import { columnsByField, type ColumnMapping } from '../model/fields';

/**
 * One CSV row → one product input the catalogue can store, or the reasons it
 * cannot. Pure and deterministic: the browser runs it for the preview, the
 * server runs it again before writing and trusts only its own result.
 */

export const ROW_LIMITS = {
  title: 512,
  description: 50_000,
  tags: 50,
  tag: 64,
  vendor: 255,
  productType: 255,
  currency: 8,
  sku: 128,
  images: 12,
  alt: 512
} as const;

export type RowIssueCode =
  | 'title_missing'
  | 'title_too_long'
  | 'description_too_long'
  | 'price_invalid'
  | 'price_max_below_min'
  | 'currency_invalid'
  | 'too_many_tags'
  | 'tag_too_long'
  | 'image_url_invalid'
  | 'image_url_insecure'
  | 'too_many_images'
  | 'no_image'
  | 'sku_too_long'
  | 'field_truncated';

export interface RowIssue {
  code: RowIssueCode;
  detail?: string;
}

export interface ImportImage {
  src: string;
  alt: string | null;
}

export interface ImportRowInput {
  title: string;
  descriptionHtml: string;
  tags: string[];
  vendor: string | null;
  productType: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  sku: string | null;
  handle: string;
  images: ImportImage[];
}

export interface RowValidation {
  /** 1-based data row, as the merchant sees it in their spreadsheet. */
  row: number;
  input: ImportRowInput | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

/** Multi-value cells: our export joins with " | "; merchants type commas. */
export function splitList(raw: string): string[] {
  const sep = raw.includes('|') ? '|' : ',';
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * `24.00`, `24,00`, `€24`, `24 €`, `1 299,90`, `1,299.90` → number.
 * The last separator is the decimal one; anything else is grouping.
 */
export function parsePrice(raw: string): number | null | 'invalid' {
  const s = raw.replace(/[^\d.,-]/g, '').trim();
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma === -1 && lastDot === -1) normalized = s;
  else if (lastComma > lastDot)
    normalized = s.slice(0, lastComma).replace(/[.,]/g, '') + '.' + s.slice(lastComma + 1);
  else normalized = s.slice(0, lastDot).replace(/[.,]/g, '') + '.' + s.slice(lastDot + 1);
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return 'invalid';
  return Math.round(n * 100) / 100;
}

/**
 * Description HTML from an untrusted file. An allow-list, never a deny-list:
 * a scraped catalogue can carry scripts, event handlers or javascript: links
 * that would run in the merchant's own dashboard — and in their shop once
 * applied. Plain text (no tag at all) becomes paragraphs.
 */
export function sanitizeDescription(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  const source = /<[a-z][\s\S]*>/i.test(trimmed)
    ? trimmed
    : trimmed
        .split(/\n\s*\n/)
        .map((p) => `<p>${escapeText(p).replace(/\n/g, '<br />')}</p>`)
        .join('\n');
  return sanitizeHtml(source, {
    allowedTags: [
      'p',
      'br',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      'b',
      'i',
      'u',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td'
    ],
    allowedAttributes: { a: ['href', 'title', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener' }, true)
    }
  }).trim();
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Only https, only a host, no credentials in the URL. */
export function validateImageUrl(
  raw: string
): { ok: true; url: string } | { ok: false; code: RowIssueCode } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, code: 'image_url_invalid' };
  }
  if (url.protocol === 'http:') return { ok: false, code: 'image_url_insecure' };
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    return { ok: false, code: 'image_url_invalid' };
  }
  return { ok: true, url: url.toString() };
}

function cell(cells: readonly string[], col: number | undefined): string {
  return col === undefined ? '' : (cells[col] ?? '').trim();
}

/**
 * Validate one row. `requireImage` follows the catalogue rule that a manual
 * product needs at least one image; an update of an existing product that
 * already has some may relax it (the caller knows, this function does not).
 */
export function normalizeRow(
  cells: readonly string[],
  mapping: ColumnMapping,
  row: number,
  opts: { requireImage?: boolean } = {}
): RowValidation {
  const col = columnsByField(mapping);
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  let title = cell(cells, col.title);
  if (title === '') errors.push({ code: 'title_missing' });
  if (title.length > ROW_LIMITS.title) {
    title = title.slice(0, ROW_LIMITS.title);
    warnings.push({ code: 'title_too_long' });
  }

  let descriptionHtml = sanitizeDescription(cell(cells, col.description));
  if (descriptionHtml.length > ROW_LIMITS.description) {
    descriptionHtml = descriptionHtml.slice(0, ROW_LIMITS.description);
    warnings.push({ code: 'description_too_long' });
  }

  let tags = Array.from(new Set(splitList(cell(cells, col.tags))));
  if (tags.some((t) => t.length > ROW_LIMITS.tag)) {
    tags = tags.map((t) => t.slice(0, ROW_LIMITS.tag));
    warnings.push({ code: 'tag_too_long' });
  }
  if (tags.length > ROW_LIMITS.tags) {
    tags = tags.slice(0, ROW_LIMITS.tags);
    warnings.push({ code: 'too_many_tags' });
  }

  const vendor = clip(cell(cells, col.vendor), ROW_LIMITS.vendor, warnings);
  const productType = clip(cell(cells, col.productType), ROW_LIMITS.productType, warnings);

  const priceMinRaw = parsePrice(cell(cells, col.price));
  const priceMaxRaw = parsePrice(cell(cells, col.priceMax));
  let priceMin: number | null = null;
  let priceMax: number | null = null;
  if (priceMinRaw === 'invalid')
    errors.push({ code: 'price_invalid', detail: cell(cells, col.price) });
  else priceMin = priceMinRaw;
  if (priceMaxRaw === 'invalid')
    errors.push({ code: 'price_invalid', detail: cell(cells, col.priceMax) });
  else priceMax = priceMaxRaw;
  if (priceMin != null && priceMax != null && priceMax < priceMin) {
    errors.push({ code: 'price_max_below_min' });
  }
  if (priceMax == null) priceMax = priceMin;

  let currency: string | null = cell(cells, col.currency).toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    if (currency === '€') currency = 'EUR';
    else if (currency === '$') currency = 'USD';
    else if (currency === '£') currency = 'GBP';
    else {
      errors.push({ code: 'currency_invalid', detail: currency });
      currency = null;
    }
  }

  let sku: string | null = cell(cells, col.sku) || null;
  if (sku && sku.length > ROW_LIMITS.sku) {
    sku = sku.slice(0, ROW_LIMITS.sku);
    warnings.push({ code: 'sku_too_long' });
  }

  const handleRaw = cell(cells, col.handle);
  const handle = slugify(handleRaw || title) || slugify(sku ?? '') || '';

  const urls = splitList(cell(cells, col.imageUrls));
  const alts = splitList(cell(cells, col.imageAlts));
  const images: ImportImage[] = [];
  urls.forEach((u, i) => {
    const v = validateImageUrl(u);
    if (!v.ok) {
      errors.push({ code: v.code, detail: u.slice(0, 200) });
      return;
    }
    images.push({ src: v.url, alt: alts[i] ? alts[i].slice(0, ROW_LIMITS.alt) : null });
  });
  if (images.length > ROW_LIMITS.images) {
    images.length = ROW_LIMITS.images;
    warnings.push({ code: 'too_many_images' });
  }
  if (
    (opts.requireImage ?? true) &&
    images.length === 0 &&
    !errors.some((e) => e.code.startsWith('image_url'))
  ) {
    errors.push({ code: 'no_image' });
  }

  const input: ImportRowInput | null =
    errors.length === 0
      ? {
          title,
          descriptionHtml,
          tags,
          vendor,
          productType,
          priceMin,
          priceMax,
          currency,
          sku,
          handle,
          images
        }
      : null;
  return { row, input, errors, warnings };
}

function clip(value: string, max: number, warnings: RowIssue[]): string | null {
  if (value === '') return null;
  if (value.length > max) {
    warnings.push({ code: 'field_truncated' });
    return value.slice(0, max);
  }
  return value;
}
