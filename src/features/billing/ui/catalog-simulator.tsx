'use client';

import { Input, Label, TextField } from '@heroui/react';
import { Coins } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  CUSTOM_QUOTE_THRESHOLDS,
  getCreditPack,
  PLAN_TIERS,
  recommendPlanForCatalog
} from '@/entities/ai-model';

const PRESETS = [50, 200, 1000, 5000] as const;

/**
 * "How many products?" → credits for one full pass + the tier to pick.
 * A merchant with 1 000 products does not need a fifth card, they need to
 * know which of the four (plus packs) covers them — or that we should talk.
 */
export function CatalogSimulator({ initial = 200 }: { initial?: number }) {
  const t = useTranslations('Pricing.simulator');
  const locale = useLocale();
  const [raw, setRaw] = useState(String(initial));
  const products = Math.max(0, Math.floor(Number(raw) || 0));
  const rec = recommendPlanForCatalog(products);
  const planName = rec.plan === 'custom' ? null : PLAN_TIERS.find((p) => p.id === rec.plan)?.name;
  const packName = rec.packs ? getCreditPack(rec.packs.id)?.name : null;

  return (
    <section
      className="w-full max-w-3xl mx-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 flex flex-col gap-4"
      data-testid="catalog-simulator"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-xs text-[var(--muted)]">{t('hint')}</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <TextField
          name="products"
          type="number"
          value={raw}
          onChange={setRaw}
          className="w-full sm:w-48"
          aria-label={t('label')}
        >
          <Label>{t('label')}</Label>
          <Input inputMode="numeric" min={0} max={100000} step={1} />
        </TextField>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('presetsAria')}>
          {PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRaw(String(n))}
              aria-pressed={products === n}
              className={`px-2.5 py-1.5 rounded-md text-xs font-mono border transition-colors ${
                products === n
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {n.toLocaleString(locale)}
            </button>
          ))}
        </div>
      </div>
      <div
        className="flex flex-col gap-1 text-sm border-t border-[var(--border)] pt-3"
        aria-live="polite"
        data-testid="catalog-simulator-result"
      >
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Coins className="size-4 text-[var(--accent)]" aria-hidden />
          {t('credits', { credits: rec.credits })}
        </span>
        {rec.plan === 'custom' ? (
          <span className="text-[var(--muted)]">
            {t('custom', { products: CUSTOM_QUOTE_THRESHOLDS.products })}{' '}
            <Link href="/contact" className="text-[var(--accent)] underline underline-offset-2">
              {t('customCta')}
            </Link>
          </span>
        ) : rec.packs && packName ? (
          <span className="text-[var(--muted)]">
            {t('recommendedPacks', {
              plan: planName ?? rec.plan,
              count: rec.packs.count,
              pack: packName,
              extra: rec.extraCredits
            })}
          </span>
        ) : (
          <span className="text-[var(--muted)]">
            {t('recommended', { plan: planName ?? rec.plan })}
          </span>
        )}
      </div>
    </section>
  );
}
