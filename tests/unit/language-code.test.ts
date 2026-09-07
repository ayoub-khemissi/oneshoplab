import { describe, expect, it } from 'vitest';
import { languageCodeFromLocale } from '@/shared/i18n';

describe('languageCodeFromLocale', () => {
  it('collapses platform locale tags to ISO 639-1', () => {
    expect(languageCodeFromLocale('fr-FR')).toBe('fr'); // Shopify
    expect(languageCodeFromLocale('fr_FR')).toBe('fr'); // WordPress
    expect(languageCodeFromLocale('de_DE_formal')).toBe('de');
    expect(languageCodeFromLocale('pt-BR')).toBe('pt');
    expect(languageCodeFromLocale('zh-Hans-CN')).toBe('zh');
    expect(languageCodeFromLocale('IT')).toBe('it'); // Wix (already short)
    expect(languageCodeFromLocale('  en  ')).toBe('en');
  });

  it('refuses what the picker could not display', () => {
    expect(languageCodeFromLocale(null)).toBeNull();
    expect(languageCodeFromLocale('')).toBeNull();
    expect(languageCodeFromLocale('C')).toBeNull();
    expect(languageCodeFromLocale('POSIX')).toBeNull();
    expect(languageCodeFromLocale('qq-XX')).toBeNull();
    expect(languageCodeFromLocale('123')).toBeNull();
  });
});
