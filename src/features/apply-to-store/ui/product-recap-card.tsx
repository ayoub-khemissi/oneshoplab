'use client';

import { AlertTriangle, Check, Clock, Sparkles, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { RecapRow, RecapState } from '../lib/product-recap';

const ICONS: Record<RecapState, typeof Check> = {
  to_apply: Sparkles,
  sending: Clock,
  applied: Check,
  conflict: AlertTriangle,
  failed: XCircle
};

const TONES: Record<RecapState, string> = {
  to_apply: 'text-[var(--accent)]',
  sending: 'text-[var(--muted)]',
  applied: 'text-[var(--success)]',
  conflict: 'text-[var(--warning,var(--danger))]',
  failed: 'text-[var(--danger)]'
};

/**
 * One line per generated field: what it is, and who is waiting on it. The page
 * used to answer neither — the store-side banner counts only what has already
 * been sent, so a rewritten set of tags nobody applied appeared nowhere at all.
 */
export function ProductRecapCard({ rows }: { rows: RecapRow[] }) {
  const t = useTranslations('ProductRecap');
  const format = useFormatter();
  if (rows.length === 0) return null;

  const toApply = rows.filter((r) => r.state === 'to_apply').length;

  return (
    <section
      data-testid="product-recap"
      data-to-apply={toApply}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-col gap-2"
    >
      <h2 className="text-sm font-semibold">
        {toApply > 0 ? t('titleToApply', { count: toApply }) : t('titleAllSent')}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const Icon = ICONS[row.state];
          return (
            <li key={row.field} className="flex flex-wrap items-center gap-2 text-xs">
              <Icon className={`size-3.5 shrink-0 ${TONES[row.state]}`} aria-hidden />
              <span className="font-medium">{t(`field.${row.field}`)}</span>
              <span className={TONES[row.state]}>{t(`state.${row.state}`)}</span>
              {row.atIso ? (
                <span className="text-[var(--muted)]">
                  {format.relativeTime(new Date(row.atIso))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-[var(--muted)]">
        {toApply > 0 ? t('hintToApply') : t('hintAllSent')}
      </p>
    </section>
  );
}
