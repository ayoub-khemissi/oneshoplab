// Relative on purpose. e2e/global-setup.ts loads this module transitively
// (through entities/audit/lib/score), and Playwright's TS loader only maps
// the `@/` alias for the files it is handed directly — a `@/…` require from
// inside src/ reaches plain Node resolution and fails. Every other import in
// score.ts is type-only, which is why the trap only appeared here. An entity
// reading from shared is legal in the layering either way.
import { findLanguage, languageCodeFromLocale } from '../../../shared/i18n/languages';

/**
 * Language detection for a storefront, in two independent flavours.
 *
 * Why two: product titles are the WORST possible language sample. A French
 * shop sells "Schwarzkopf Permanent Natural Hair Colour - Olive Oil and
 * Lavender Extract", and counting stopwords over that says English. The
 * page's own declared language is both cheaper and far more reliable, and
 * we already hold the home HTML from platform detection — we were simply
 * throwing it away. Text detection stays as the fallback for the cases
 * where the markup declares nothing.
 *
 * Both functions are pure and return null rather than guessing: a null is
 * surfaced to the merchant as "we could not tell, pick one", which is much
 * cheaper than silently generating a whole catalogue in the wrong language.
 */

/**
 * Visible text of a storefront page: scripts, styles and markup removed.
 * This is the richest language sample we can get for free — a home page
 * carries the merchant's own navigation, section titles and footer, in the
 * language they actually sell in.
 */
export function textFromHtml(html: string | null | undefined, max = 40_000): string {
  if (!html) return '';
  return html
    .slice(0, 400_000)
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** `<html lang="fr-FR">` → `fr`. Also reads og:locale and the html tag's xml:lang. */
export function languageFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  // The <html> tag lives in the first few KB; scanning further only costs time.
  const head = html.slice(0, 200_000);

  const htmlTag = head.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const fromTag =
    htmlTag.match(/\blang\s*=\s*["']([^"']{2,35})["']/i)?.[1] ??
    htmlTag.match(/\bxml:lang\s*=\s*["']([^"']{2,35})["']/i)?.[1] ??
    null;
  const tagCode = languageCodeFromLocale(fromTag);
  if (tagCode) return tagCode;

  // og:locale is written `fr_FR`; attribute order varies between templates.
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/property\s*=\s*["']og:locale["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']{2,35})["']/i)?.[1] ?? null;
    const code = languageCodeFromLocale(content);
    if (code) return code;
  }
  return null;
}

/** Scripts that identify a language on sight, with no word list needed. */
const SCRIPTS: Array<{ code: string; re: RegExp }> = [
  { code: 'ko', re: /[가-힯ᄀ-ᇿ]/g },
  { code: 'ja', re: /[぀-ゟ゠-ヿ]/g },
  { code: 'zh', re: /[一-鿿]/g },
  { code: 'ru', re: /[Ѐ-ӿ]/g },
  { code: 'ar', re: /[؀-ۿ]/g }
];

/**
 * Function words, chosen to be frequent in their language AND rare in the
 * neighbours. That second half is the hard part and the reason this table
 * looks arbitrary: "de" is useless (French, Spanish, Portuguese, Dutch all
 * use it) and actively harmful — an earlier version listed it under Dutch
 * and every French shop scored Dutch high enough to cancel French's margin,
 * which is how a French store ended up flagged English. "la" and "le" are
 * out for the same reason (Spanish and Italian), while "votre", "gli",
 * "você" and "für" each belong to exactly one language.
 *
 * Scope is the thirteen languages the product itself speaks. Anything else
 * lands on the non-Latin script test above, or on a null verdict.
 */
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'with', 'this', 'your', 'from', 'our', 'is', 'are', 'you', 'of', 'for'],
  fr: ['les', 'des', 'une', 'avec', 'pour', 'votre', 'cette', 'sans', 'qui', 'est', 'dans', 'nos'],
  es: ['los', 'las', 'del', 'para', 'más', 'pero', 'como', 'muy', 'sus', 'nuestros', 'también'],
  it: ['gli', 'della', 'dei', 'nel', 'sono', 'anche', 'questo', 'questa', 'delle', 'negli', 'più'],
  pt: ['não', 'você', 'uma', 'dos', 'das', 'seu', 'sua', 'mais', 'são', 'pelo', 'nossos'],
  de: ['der', 'die', 'das', 'und', 'mit', 'für', 'eine', 'einen', 'ist', 'nicht', 'auch', 'sie'],
  pl: ['nie', 'jest', 'oraz', 'dla', 'się', 'który', 'która', 'przez', 'tego', 'jak', 'lub', 'ale'],
  tr: ['ve', 'bir', 'için', 'ile', 'bu', 'olan', 'daha', 'çok', 'gibi', 'olarak', 'her', 'en']
};

export interface LanguageSample {
  /** Product title — a weak signal: brand names are rarely translated. */
  title?: string | null;
  /** Description text (HTML already stripped) — the signal that counts. */
  text?: string | null;
}

const DESCRIPTION_WEIGHT = 3;
/** Below this many function-word hits the sample says nothing. */
const MIN_HITS = 6;
/** The winner must be this much ahead of the runner-up, or we admit we don't know. */
const MIN_RATIO = 1.4;

/**
 * Detect the language of a catalogue from its text. Descriptions weigh more
 * than titles, and an unclear verdict returns null instead of a coin flip.
 */
export function languageFromText(samples: LanguageSample[]): string | null {
  let weighted = '';
  for (const s of samples) {
    if (s.title) weighted += ' ' + s.title;
    if (s.text) weighted += (' ' + s.text).repeat(DESCRIPTION_WEIGHT);
  }
  const corpus = weighted.toLowerCase();
  if (corpus.trim().length < 60) return null;

  // A non-Latin script settles it on its own.
  const letters = corpus.match(/\p{L}/gu)?.length ?? 0;
  if (letters > 0) {
    for (const { code, re } of SCRIPTS) {
      const hits = corpus.match(re)?.length ?? 0;
      if (hits / letters > 0.2) return code;
    }
  }

  const tokens = corpus.match(/\p{L}+/gu) ?? [];
  if (tokens.length < 20) return null;

  const counts = new Map<string, number>();
  for (const token of tokens) {
    for (const [lang, words] of Object.entries(STOPWORDS)) {
      if (words.includes(token)) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [best, runnerUp] = ranked;
  if (!best || best[1] < MIN_HITS) return null;
  if (runnerUp && best[1] < runnerUp[1] * MIN_RATIO) return null;
  return best[0];
}

export interface LanguageEvidence {
  /** Visible text of the storefront home page. The best evidence there is:
   *  it is the merchant's own navigation, sections and footer. */
  pageText?: string | null;
  /** Catalogue samples. Weaker — imported product names are rarely
   *  translated, and a shop can sell "Permanent Hair Colour" in French. */
  products?: LanguageSample[];
  /** `<html lang>`. Last resort: themes ship `lang="en"` untouched. */
  declared?: string | null;
}

/**
 * Settle on one language for the catalogue, best evidence first.
 *
 * The order was earned on a real store. afrometis.com is a Shopify shop
 * written entirely in French: it declares `<html lang="en">` because the
 * merchant never switched the theme locale, and its catalogue is full of
 * imported names like "Schwarzkopf Permanent Natural Hair Colour". Counting
 * words over the catalogue said English, and so did the declaration — the
 * whole shop would have been rewritten in the wrong language. Its home page
 * text, weighed on its own, scores French twice as high as English.
 *
 * Hence: the page's own words, then the catalogue, then the declaration.
 * Mixing them into one bag does not work — forty product descriptions drown
 * a single home page, which is exactly how this bug shipped.
 *
 * Null stays null. The dashboard shows a red warning next to the language,
 * which costs the merchant one click and is far cheaper than a confident
 * mistake applied to every product.
 */
export function resolveDetectedLanguage(evidence: LanguageEvidence): string | null {
  const fromPage = evidence.pageText ? languageFromText([{ text: evidence.pageText }]) : null;
  if (fromPage) return fromPage;

  const fromCatalogue = evidence.products?.length ? languageFromText(evidence.products) : null;
  if (fromCatalogue) return fromCatalogue;

  return evidence.declared?.trim() ? (findLanguage(evidence.declared)?.code ?? null) : null;
}
