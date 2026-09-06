'use client';

import { Card, ListBox, Select } from '@heroui/react';
import { Archive, ArchiveRestore, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Link, useRouter } from '@/i18n/navigation';
import { DebouncedSearchInput, InfoHint, ServerPagination, type InfoHintTopic } from '@/shared/ui';
import { setProductArchivedAction } from '@/features/archive-product/actions';

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
  optimCount?: number;
  lastOptimAtIso?: string | null;
  aiCompleted?: boolean;
  /** Free-form category — Shopify product_type, first WC/Wix category,
   *  or whatever the user typed for a manual product. Required (nullable)
   *  to keep the type predicate clean at call sites. */
  productType: string | null;
}

type SortKey = 'recently-optimized' | 'score-asc' | 'score-desc' | 'title-asc' | 'title-desc';

interface PaginatedProductsListProps {
  /** Server-paginated slice for the current page only. */
  products: PaginatedProduct[];
  /** Site UUID — used to build per-product URLs. */
  siteId: string;
  page: number;
  totalPages: number;
  /** Total active product count in the merchant's catalog. */
  totalActiveCount: number;
  /** Total archived count — drives the toggle visibility. */
  totalArchivedCount: number;
  /** Count of products matching the current query/archived filter. */
  filteredTotal: number;
  /** Search query reflected from the URL — seeds the input on mount. */
  query: string;
  /** Sort key reflected from the URL. */
  sort: SortKey;
  /** Whether archived rows are merged into the visible set. */
  showArchived: boolean;
}

/**
 * Dashboard list of products in the user's latest audit. Filter +
 * sort + pagination + archived toggle are ALL URL-controlled so the
 * current view is shareable / refresh-stable / back-button-friendly.
 *
 * The component is otherwise server-driven: each prop reflects a URL
 * search param, and changes route through router.push instead of
 * local state. Only the search input keeps a local controlled value
 * so typing stays smooth — a debounce pushes the URL update once the
 * user stops typing for 350ms.
 */
export function PaginatedProductsList({
  products,
  siteId,
  page,
  totalPages,
  totalActiveCount,
  totalArchivedCount,
  filteredTotal,
  query,
  sort,
  showArchived
}: PaginatedProductsListProps) {
  const t = useTranslations('Dashboard');
  const tIssues = useTranslations('Issues');
  const tHelp = useTranslations('FieldHelp');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Debounced search lives in the shared <DebouncedSearchInput>; on
  // settle it pushes the URL (server-side filter + pagination reset).
  const onSearch = (q: string) => {
    if (q === query) return;
    startTransition(() => {
      router.push(
        buildHref({
          tab: 'products',
          q: q || null,
          sort,
          showArchived,
          productsPage: 1
        })
      );
    });
  };

  function navigate(
    next: Partial<{
      q: string | null;
      sort: SortKey;
      showArchived: boolean;
      productsPage: number;
    }>
  ): void {
    startTransition(() => {
      router.push(
        buildHref({
          tab: 'products',
          q: next.q !== undefined ? next.q : query.trim() || null,
          sort: next.sort ?? sort,
          showArchived: next.showArchived ?? showArchived,
          productsPage: next.productsPage ?? page
        })
      );
    });
  }

  if (totalActiveCount === 0 && totalArchivedCount === 0) return null;

  const start = (page - 1) * 15;
  const end = Math.min(start + products.length, filteredTotal);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">
          {t('allProductsSection')}
          <span className="ml-2 text-sm font-normal text-[var(--muted)] font-mono">
            ({filteredTotal}
            {filteredTotal !== totalActiveCount ? `/${totalActiveCount}` : ''})
          </span>
        </h2>
        {totalPages > 1 ? (
          <span className="text-xs text-[var(--muted)] font-mono">
            {t('paginationRange', {
              from: start + 1,
              to: end,
              total: filteredTotal
            })}
          </span>
        ) : null}
      </header>

      <div className="flex flex-col sm:flex-row gap-2">
        <DebouncedSearchInput
          value={query}
          onDebouncedChange={onSearch}
          placeholder={t('searchPlaceholder')}
          ariaLabel={t('searchPlaceholder')}
          className="flex-1"
        />
        <SortPicker value={sort} onChange={(v) => navigate({ sort: v, productsPage: 1 })} t={t} />
        {totalArchivedCount > 0 ? (
          <button
            type="button"
            onClick={() => navigate({ showArchived: !showArchived, productsPage: 1 })}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border whitespace-nowrap ${
              showArchived
                ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
            }`}
            aria-pressed={showArchived}
          >
            <Archive className="size-3.5" aria-hidden />
            {showArchived ? t('hideArchived') : t('showArchived', { count: totalArchivedCount })}
          </button>
        ) : null}
      </div>

      {products.length === 0 ? (
        <p className="text-sm text-[var(--muted)] italic py-6 text-center">
          {t('noProductsMatching')}
        </p>
      ) : null}

      <ul className={`flex flex-col gap-2 ${isPending ? 'opacity-60 transition-opacity' : ''}`}>
        {products.map((p, i) => (
          // The walkthrough points at the first row: any product will do to
          // show what a product page is, and the first one is on screen.
          <li key={p.productId} data-tour={i === 0 ? 'product-row' : undefined}>
            {/* Stacks on mobile. As a permanent row, the actions column took
                about half the width and squeezed the issues into a ribbon of
                two or three words per line, while `items-center` floated the
                button in the middle of a tall text block. */}
            <Card
              variant="secondary"
              className={`p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 ${
                p.archived ? 'opacity-60' : ''
              }`}
            >
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Score and title stay on one line whatever the title's
                      length, so every card in the list has the same shape; the
                      badges wrap below on their own. Without this the wrap
                      point moved from card to card. */}
                  <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
                    {p.archived ? (
                      <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--muted)]/15 text-[var(--muted)] inline-flex items-center gap-1 shrink-0">
                        <Archive className="size-3" aria-hidden />
                        {t('archivedBadge')}
                      </span>
                    ) : (
                      <ScoreChip score={p.score} />
                    )}
                    {p.archived ? (
                      <span className="font-medium truncate">{p.title}</span>
                    ) : (
                      <Link
                        href={`/dashboard/sites/${siteId}/products/${p.productId}`}
                        className="font-medium hover:underline truncate min-w-0"
                      >
                        {p.title}
                      </Link>
                    )}
                  </div>
                  {!p.archived && p.aiCompleted ? (
                    <span
                      className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--success)]/10 text-[var(--success)] inline-flex items-center gap-1"
                      title={t('aiCompletedTitle')}
                    >
                      <CheckCircle2 className="size-3" aria-hidden />
                      {t('aiCompletedBadge')}
                    </span>
                  ) : !p.archived && (p.optimCount ?? 0) > 0 ? (
                    <span
                      className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] inline-flex items-center gap-1"
                      title={t('aiStartedTitle')}
                    >
                      <Sparkles className="size-3" aria-hidden />
                      {t('aiStartedBadge')}
                    </span>
                  ) : null}
                  {p.productType?.trim() ? (
                    <span
                      className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--default)] text-[var(--muted)] border border-[var(--border)] truncate max-w-[12rem]"
                      title={p.productType}
                    >
                      {p.productType}
                    </span>
                  ) : null}
                </div>
                {p.issues.length > 0 && (
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="text-[var(--foreground)]">{t('issuesLabel')}:</strong>{' '}
                    {p.issues.map((issue, index) => {
                      const text = translateIssue(tIssues, issue);
                      return (
                        <span key={`${issue.code}-${index}`}>
                          {index > 0 ? ' · ' : null}
                          {text}
                          {/* A stored audit summary can carry an issue code
                              this build no longer knows: ask the catalog
                              rather than keeping a second list of codes. */}
                          {tHelp.has(`issue.${issue.code}`) ? (
                            <InfoHint
                              topic={`issue.${issue.code}` as InfoHintTopic}
                              label={text}
                              className="ml-1"
                            />
                          ) : null}
                        </span>
                      );
                    })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 sm:shrink-0">
                <ArchiveToggle
                  siteId={siteId}
                  productId={p.productId}
                  archived={!!p.archived}
                  t={t}
                />
                <Link
                  href={`/dashboard/sites/${siteId}/products/${p.productId}`}
                  className={`flex-1 justify-center px-3 py-1.5 text-sm rounded-md whitespace-nowrap font-medium inline-flex items-center gap-1.5 transition-opacity sm:flex-none ${
                    p.archived
                      ? 'border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
                      : 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90'
                  }`}
                >
                  {p.archived ? t('viewArchived') : t('optimizeButton')}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <ServerPagination
        currentPage={page}
        totalPages={totalPages}
        ariaLabel="Products pagination"
        hrefForPage={(p) =>
          buildHref({
            tab: 'products',
            q: query.trim() || null,
            sort,
            showArchived,
            productsPage: p
          })
        }
      />
    </section>
  );
}

function buildHref(state: {
  tab: string;
  q: string | null;
  sort: SortKey;
  showArchived: boolean;
  productsPage: number;
}): string {
  const params = new URLSearchParams();
  params.set('tab', state.tab);
  if (state.q) params.set('q', state.q);
  if (state.sort && state.sort !== 'recently-optimized') {
    params.set('sort', state.sort);
  }
  if (state.showArchived) params.set('showArchived', '1');
  if (state.productsPage > 1) {
    params.set('productsPage', String(state.productsPage));
  }
  return `?${params.toString()}`;
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
    { id: 'recently-optimized', label: t('sortRecentlyOptimized') },
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

function ArchiveToggle({
  siteId,
  productId,
  archived,
  t
}: {
  siteId: string;
  productId: string;
  archived: boolean;
  t: (key: string) => string;
}) {
  const label = archived ? t('unarchiveProduct') : t('archiveProduct');
  return (
    <form
      action={setProductArchivedAction}
      onSubmit={(e) => {
        // Restore is harmless; only guard the archive direction.
        if (!archived && !window.confirm(t('archiveConfirm'))) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="projectId" value={siteId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="archived" value={archived ? '0' : '1'} />
      <ArchiveSubmit archived={archived} label={label} />
    </form>
  );
}

function ArchiveSubmit({ archived, label }: { archived: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--default)] transition-colors disabled:opacity-50 disabled:pointer-events-none"
    >
      {archived ? (
        <ArchiveRestore className="size-4" aria-hidden />
      ) : (
        <Archive className="size-4" aria-hidden />
      )}
    </button>
  );
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
