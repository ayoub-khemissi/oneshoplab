import { defineRouting } from 'next-intl/routing';

/**
 * Locales we ship message files for. Order is preserved in the locale picker.
 * `en` stays the fallback (untranslated keys render the English copy).
 */
export const SUPPORTED_LOCALES = [
  'en',
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'ru',
  'pl',
  'tr',
  'ar',
  'zh',
  'ja',
  'ko'
] as const;

export const LOCALE_LABELS: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  ru: 'Русский',
  pl: 'Polski',
  tr: 'Türkçe',
  ar: 'العربية',
  zh: '中文',
  ja: '日本語',
  ko: '한국어'
};

/** Country/region flag emoji for each locale (rendered as emoji in the picker). */
export const LOCALE_FLAGS: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  es: '🇪🇸',
  de: '🇩🇪',
  it: '🇮🇹',
  pt: '🇵🇹',
  ru: '🇷🇺',
  pl: '🇵🇱',
  tr: '🇹🇷',
  ar: '🇸🇦',
  zh: '🇨🇳',
  ja: '🇯🇵',
  ko: '🇰🇷'
};

/**
 * ISO 3166-1 alpha-2 country code per locale, used by the flag-icons CSS
 * classes (`fi fi-${code}`). Cross-platform SVG flags so Windows users
 * who don't ship flag glyphs in Segoe UI Emoji still see a flag.
 */
export const LOCALE_COUNTRY_CODES: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  en: 'gb',
  fr: 'fr',
  es: 'es',
  de: 'de',
  it: 'it',
  pt: 'pt',
  ru: 'ru',
  pl: 'pl',
  tr: 'tr',
  ar: 'sa',
  zh: 'cn',
  ja: 'jp',
  ko: 'kr'
};

/** Locales that read right-to-left. */
export const RTL_LOCALES = new Set<(typeof SUPPORTED_LOCALES)[number]>(['ar']);

export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: 'en',
  localePrefix: 'always'
});

export type Locale = (typeof routing.locales)[number];
