'use client';

import { Card, InputGroup, ListBox, Pagination, Select, TextField } from '@heroui/react';
import { Archive, ArrowRight, ExternalLink, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';

export interface PaginatedProduct {
  /** Stable UUID from the products table. Used to build the URL — no slug
   *  collisions, no encoding pitfalls with UTF-8 handles. */
  productId: string;
  sourceId: string | null;
  handle: string | null;
  title: string;
  url: string | null;
  score: number;
  issues: Array<{ code: string; data?: Record<string, string | number> }>;
  archived?: boolean;
}

interface PaginatedProductsListProps {
  products: PaginatedProduct[];
  /** Soft-archived products — hidden by default, revealed via a toggle. */
  archivedProducts?: PaginatedProduct[];
  /** Project UUID — used to build the per-site product URL. */
  siteId: string;
  pageSize?: number;
}

type SortKey = 'score-asc' | 'score-desc' | 'title-asc' | 'title-desc';

const DEFAULT_SORT: SortKey = 'score-asc';

/**
 * Dashboard list of every product in the user's latest audit, with search +
 * sort + pagination. Sorted worst-first by default — the most actionable
 * items surface immediately. The caller passes already-sorted products; we
 * resort client-side when the user picks a different option.
 */
export function PaginatedProductsList({
  products,
  archivedProducts = [],
  siteId,
  pageSize = 10
}: PaginatedProductsListProps) {
  const t = useTranslations('Dashboard');
  const tIssues = useTranslations('Issues');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [showArchived, setShowArchived] = useState(false);

  // Reset to page 1 whenever the visible set changes. Otherwise a search +
  // current page = 7 lands the user on an empty page.
  useEffect(() => {
    setPage(1);
  }, [query, sort, showArchived]);

  const visibleSource = useMemo(
    () => (showArchived ? [...products, ...archivedProducts] : products),
    [products, archivedProducts, showArchived]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? visibleSource.filter((p) => p.title.toLowerCase().includes(q))
      : visibleSource;
    const sorted = [...base];
    sorted.sort((a, b) => {
      // Archived products sink to the bottom regardless of the chosen sort —
      // they're a "secondary" set the merchant rarely cares about.
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      switch (sort) {
        case 'score-asc':
          return a.score - b.score;
        case 'score-desc':
          return b.score - a.score;
        case 'title-asc':
          return a.title.localeCompare(b.title);
        case 'title-desc':
          return b.title.localeCompare(a.title);
      }
    });
    return sorted;
  }, [visibleSource, query, sort]);

  if (products.length === 0 && archivedProducts.length === 0) return null;

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">
          {t('allProductsSection')}
          <span className="ml-2 text-sm font-normal text-[var(--muted)] font-mono">
            ({filtered.length}
            {filtered.length !== products.length ? `/${products.length}` : ''})
          </span>
        </h2>
        {totalPages > 1 ? (
          <span className="text-xs text-[var(--muted)] font-mono">
            {t('paginationRange', {
              from: start + 1,
              to: Math.min(start + pageSize, filtered.length),
              total: filtered.length
            })}
          </span>
        ) : null}
      </header>

      <div className="flex flex-col sm:flex-row gap-2">
        <TextField
          aria-label={t('searchPlaceholder')}
          value={query}
          onChange={setQuery}
          className="flex-1"
        >
          <InputGroup>
            <InputGroup.Prefix>
              <Search className="size-4" />
            </InputGroup.Prefix>
            <InputGroup.Input
              type="search"
              placeholder={t('searchPlaceholder')}
            />
          </InputGroup>
        </TextField>
        <SortPicker value={sort} onChange={setSort} t={t} />
        {archivedProducts.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border whitespace-nowrap ${
              showArchived
                ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
            }`}
            aria-pressed={showArchived}
          >
            <Archive className="size-3.5" aria-hidden />
            {showArchived
              ? t('hideArchived')
              : t('showArchived', { count: archivedProducts.length })}
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--muted)] italic py-6 text-center">
          {t('noProductsMatching')}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {slice.map((p) => (
          <li key={p.productId}>
            <Card
              variant="secondary"
              className={`p-4 flex flex-row items-start gap-4 ${
                p.archived ? 'opacity-60' : ''
              }`}
            >
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  {p.archived ? (
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--muted)]/15 text-[var(--muted)] inline-flex items-center gap-1">
                      <Archive className="size-3" aria-hidden />
                      {t('archivedBadge')}
                    </span>
                  ) : (
                    <ScoreChip score={p.score} />
                  )}
                  {p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium hover:underline inline-flex items-center gap-1.5 min-w-0"
                    >
                      <span className="truncate">{p.title}</span>
                      <ExternalLink className="size-3.5 opacity-60 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    <span className="font-medium truncate">{p.title}</span>
                  )}
                </div>
                {p.issues.length > 0 && (
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="text-[var(--foreground)]">
                      {t('issuesLabel')}:
                    </strong>{' '}
                    {p.issues
                      .map((i) => translateIssue(tIssues, i))
                      .join(' · ')}
                  </p>
                )}
              </div>
              <Link
                href={`/dashboard/sites/${siteId}/products/${p.productId}`}
                className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap font-medium inline-flex items-center gap-1.5 transition-opacity ${
                  p.archived
                    ? 'border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
                    : 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90'
                }`}
              >
                {p.archived ? t('viewArchived') : t('optimizeButton')}
                <ArrowRight className="size-3.5" />
              </Link>
            </Card>
          </li>
        ))}
      </ul>
      {totalPages > 1 ? (
        <div className="flex justify-center pt-2">
          <Pagination size="sm" className="w-auto">
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ‹
                </Pagination.Previous>
              </Pagination.Item>
              {pageRange(safePage, totalPages).map((entry, i) =>
                entry === 'ellipsis' ? (
                  <Pagination.Item key={`e-${i}`}>
                    <Pagination.Ellipsis>…</Pagination.Ellipsis>
                  </Pagination.Item>
                ) : (
                  <Pagination.Item key={entry}>
                    <Pagination.Link
                      isActive={entry === safePage}
                      onPress={() => setPage(entry)}
                    >
                      {entry}
                    </Pagination.Link>
                  </Pagination.Item>
                )
              )}
              <Pagination.Item>
                <Pagination.Next
                  onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  ›
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          </Pagination>
        </div>
      ) : null}
    </section>
  );
}

function SortPicker({
  value,
  onChange,
  t
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
  t: (key: string) => string;
}) {
  const options: Array<{ id: SortKey; label: string }> = [
    { id: 'score-asc', label: t('sortScoreAsc') },
    { id: 'score-desc', label: t('sortScoreDesc') },
    { id: 'title-asc', label: t('sortTitleAsc') },
    { id: 'title-desc', label: t('sortTitleDesc') }
  ];
  return (
    <Select
      selectedKey={value}
      onSelectionChange={(key) => key && onChange(String(key) as SortKey)}
      aria-label={t('sortLabel')}
      className="min-w-[200px]"
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
              {o.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function pageRange(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: Array<number | 'ellipsis'> = [1];
  if (current > 3) out.push('ellipsis');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    out.push(i);
  }
  if (current < total - 2) out.push('ellipsis');
  out.push(total);
  return out;
}

function ScoreChip({ score }: { score: number }) {
  const tone =
    score >= 75
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : score >= 50
        ? 'bg-[var(--warning)]/10 text-[var(--warning)]'
        : 'bg-[var(--danger)]/10 text-[var(--danger)]';
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded font-semibold ${tone}`}>
      {score}/100
    </span>
  );
}

/** Default placeholders for every Issues message — covers legacy audits whose
 *  `data` payload is missing the keys their translation expects (e.g. older
 *  rows without `{length}` on `short_description`). Without this fallback
 *  next-intl throws a FORMATTING_ERROR even inside a try/catch on SSR. */
const ISSUE_DEFAULTS: Record<string, string | number> = {
  length: 0,
  missing: 0,
  total: 0,
  width: 0
};

function translateIssue(
  tIssues: (key: string, values?: Record<string, string | number>) => string,
  issue: { code: string; data?: Record<string, string | number> }
): string {
  const values = { ...ISSUE_DEFAULTS, ...(issue.data ?? {}) };
  try {
    return tIssues(issue.code, values);
  } catch {
    return issue.code.replace(/_/g, ' ');
  }
}
