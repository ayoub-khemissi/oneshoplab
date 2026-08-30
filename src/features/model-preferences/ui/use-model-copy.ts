'use client';

import { useTranslations } from 'next-intl';

/**
 * Localised copy for catalog models. Model NAMES stay as-is (they're
 * product names — "Claude Sonnet 5"), but tier badges, taglines and
 * image-quality labels are user-facing prose and must follow the
 * locale. Translations live under `Models.*` in messages/*.json, keyed
 * by catalog id; when a locale (or a newly added model) has no entry
 * yet we fall back to the English text from pricing.json, so adding a
 * model never breaks a page — it just shows English until translated.
 */
export function useModelCopy() {
  const t = useTranslations('Models');
  const pick = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  return {
    tierLabel: (tier: 'budget' | 'balanced' | 'premium') => pick(`tier.${tier}`, tier),
    chatTagline: (id: string, fallback: string) => pick(`chat.${id}.tagline`, fallback),
    /** "1K · Standard" → resolution from the catalog + localised label. */
    qualityLabel: (id: string, resolution: string, fallbackDisplayName: string) =>
      t.has(`quality.${id}.label`)
        ? `${resolution} · ${t(`quality.${id}.label`)}`
        : fallbackDisplayName,
    qualityTagline: (id: string, fallback: string) => pick(`quality.${id}.tagline`, fallback)
  };
}
