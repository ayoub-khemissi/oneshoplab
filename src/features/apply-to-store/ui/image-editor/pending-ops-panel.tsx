'use client';

import { Spinner } from '@heroui/react';
import { ListChecks, Store, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OpDescription } from '../../lib/image-editor';

export interface PendingOpRow {
  id: string;
  description: OpDescription;
}

/**
 * What the merchant is about to change, in their own words, before anything
 * leaves OSL (docs/api/IMAGE-OPS.md §4). One click applies the whole list; a
 * single decision can be taken back, or the list emptied.
 */
export function PendingOpsPanel({
  rows,
  pending,
  disabled,
  onRemove,
  onClear,
  onApply
}: {
  rows: PendingOpRow[];
  pending: boolean;
  /** The queue cannot be applied as it stands (nothing queued, replay broken). */
  disabled: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onApply: () => void;
}) {
  const t = useTranslations('ProductImages');

  return (
    <div
      data-testid="pending-ops"
      data-count={rows.length}
      className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--default)]/30 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          <ListChecks className="size-3.5" aria-hidden /> {t('queueTitle', { count: rows.length })}
        </span>
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            disabled={pending}
            data-testid="queue-clear"
            className="text-[11px] text-[var(--muted)] underline underline-offset-2 hover:text-[var(--danger)] disabled:opacity-50"
          >
            {t('queueClear')}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm italic text-[var(--muted)]">{t('queueEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="queued-op"
              className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <span className="flex-1">{t(row.description.key, row.description.values)}</span>
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                disabled={pending}
                aria-label={t('queueRemove')}
                title={t('queueRemove')}
                className="inline-flex size-6 items-center justify-center rounded-md hover:bg-[var(--default)] hover:text-[var(--danger)] disabled:opacity-50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onApply}
        disabled={disabled || pending}
        data-testid="apply-image-ops"
        className="inline-flex w-fit items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <Spinner size="sm" /> : <Store className="size-4" aria-hidden />}
        {t('apply')}
      </button>
    </div>
  );
}
