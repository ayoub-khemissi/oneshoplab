/**
 * The `FieldHelp` namespace is the single source of the "why does this matter"
 * copy shown by <InfoHint>. Two couplings the compiler cannot see are pinned
 * here: every audit issue code and every score axis produced by the scorer
 * must have an explanation, in English AND in French (the two locales we
 * author by hand — `pnpm i18n:check` then propagates parity to the other 11).
 * A new issue code therefore cannot ship without telling the merchant what it
 * costs them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { audit, ISSUE_CODES } from '@/entities/audit';

type Messages = Record<string, unknown>;

function fieldHelp(locale: 'en' | 'fr'): Record<string, unknown> {
  const raw = JSON.parse(
    readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')
  ) as Messages;
  const ns = raw.FieldHelp;
  if (!ns || typeof ns !== 'object') throw new Error(`FieldHelp missing in ${locale}.json`);
  return ns as Record<string, unknown>;
}

function group(locale: 'en' | 'fr', key: 'issue' | 'score'): Record<string, string> {
  const sub = fieldHelp(locale)[key];
  if (!sub || typeof sub !== 'object') throw new Error(`FieldHelp.${key} missing in ${locale}`);
  return sub as Record<string, string>;
}

/** The four axes + the overall figure, read from the scorer's own output so
 *  a renamed or added axis shows up here rather than in a silent hole. */
const SCORE_AXES = Object.keys(audit([]).scores).sort();

const LOCALES = ['en', 'fr'] as const;

describe('FieldHelp copy', () => {
  it('covers every audit issue code, with no orphan entry', () => {
    for (const locale of LOCALES) {
      const issues = group(locale, 'issue');
      expect(Object.keys(issues).sort(), locale).toEqual([...ISSUE_CODES].sort());
    }
  });

  it('covers every score axis the scorer produces, with no orphan entry', () => {
    expect(SCORE_AXES).toEqual([
      'catalogCompleteness',
      'copyQuality',
      'overall',
      'taggingQuality',
      'visualQuality'
    ]);
    for (const locale of LOCALES) {
      expect(Object.keys(group(locale, 'score')).sort(), locale).toEqual(SCORE_AXES);
    }
  });

  it('covers every field and setting the hints are placed next to', () => {
    const expected = [
      'altText',
      'chatModel',
      'credits',
      'customInstructions',
      'description',
      'imageCount',
      'imageQuality',
      'imageResolution',
      'images',
      'issue',
      'pendingSync',
      'score',
      'tags',
      'title',
      'trigger',
      'triggerGeneric'
    ];
    for (const locale of LOCALES) {
      expect(Object.keys(fieldHelp(locale)).sort(), locale).toEqual(expected);
    }
  });

  it('is written prose, not a placeholder', () => {
    for (const locale of LOCALES) {
      const ns = fieldHelp(locale);
      const texts = Object.values(ns).flatMap((v) =>
        typeof v === 'string' ? [v] : Object.values(v as Record<string, string>)
      );
      for (const text of texts) {
        expect(text.trim().length, `${locale}: "${text}"`).toBeGreaterThan(0);
      }
      // The trigger label names the topic it sits next to.
      expect(String(ns.trigger)).toContain('{topic}');
    }
  });
});
