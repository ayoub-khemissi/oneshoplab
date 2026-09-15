'use client';

import { ArrowDownUp, Check, Columns3 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import {
  DEFAULT_COLUMN_KEYS,
  EXPORT_COLUMNS,
  exportHref,
  type ExportQuery,
  type SortDirection,
  type StatusFilter
} from '@/features/export-catalog/client';
import { DebouncedSearchInput } from '@/shared/ui';

const STATUSES: StatusFilter[] = ['active', 'archived', 'all'];

/** Search, status filter and column picker. Every change rewrites the URL,
 *  so the server re-queries and the state survives a reload or a share. */
export function ExportToolbar({ base, query }: { base: string; query: ExportQuery }) {
  const t = useTranslations('ExportCatalog');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function go(overrides: Partial<ExportQuery>) {
    startTransition(() => {
      router.push(exportHref(base, query, { page: 1, ...overrides }));
    });
  }

  function toggleColumn(key: string) {
    const next = query.columns.includes(key)
      ? query.columns.filter((c) => c !== key)
      : [...query.columns, key];
    // Never let the merchant export an empty file.
    go({ columns: next.length > 0 ? next : [...DEFAULT_COLUMN_KEYS] });
  }

  return (
    <div className="flex flex-col gap-3 min-w-0" data-pending={isPending ? '' : undefined}>
      {/* Two rows on a phone. Side by side, the search field and the status
          group cannot both fit 390px: they ended up drawn on top of each
          other. The field also carries its own search icon, so this block
          must not add a second one. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <DebouncedSearchInput
          value={query.q ?? ''}
          onDebouncedChange={(q) => go({ q: q || null })}
          placeholder={t('searchPlaceholder')}
          ariaLabel={t('searchLabel')}
          className="w-full min-w-0 md:max-w-sm"
        />
        <div
          className="inline-flex self-start md:self-auto shrink-0 rounded-md border border-[var(--border)] overflow-hidden"
          role="group"
          aria-label={t('statusLabel')}
        >
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => go({ status: s })}
              aria-pressed={query.status === s}
              className={[
                'px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                query.status === s
                  ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              ].join(' ')}
            >
              {t(`status_${s}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Sorting lives in the table header on a desktop; on a phone the table
          is a card list, so the same control has to exist here. */}
      <div className="flex items-center gap-2 md:hidden min-w-0">
        <ArrowDownUp className="size-4 text-[var(--muted)] shrink-0" aria-hidden />
        <label className="sr-only" htmlFor="export-sort">
          {t('sortLabel')}
        </label>
        <select
          id="export-sort"
          value={query.sort}
          onChange={(e) => go({ sort: e.target.value })}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs"
        >
          {EXPORT_COLUMNS.filter((c) => c.sortable).map((c) => (
            <option key={c.key} value={c.key}>
              {t(`column_${c.key}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => go({ dir: (query.dir === 'asc' ? 'desc' : 'asc') as SortDirection })}
          className="px-2 py-1.5 rounded-md border border-[var(--border)] text-xs shrink-0"
        >
          {t(query.dir === 'asc' ? 'sortAsc' : 'sortDesc')}
        </button>
      </div>

      <details className="rounded-lg border border-[var(--border)]">
        <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm font-medium">
          <Columns3 className="size-4 text-[var(--accent)]" aria-hidden />
          {t('columnsLabel')}
          <span className="text-xs text-[var(--muted)] font-normal">
            {t('columnsCount', { count: query.columns.length })}
          </span>
        </summary>
        <div className="px-3 pb-3 pt-1 flex flex-wrap gap-1.5">
          {EXPORT_COLUMNS.map((c) => {
            const on = query.columns.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleColumn(c.key)}
                aria-pressed={on}
                className={[
                  'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors',
                  on
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--foreground)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
                ].join(' ')}
              >
                {on ? <Check className="size-3" aria-hidden /> : null}
                {t(`column_${c.key}`)}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}
