import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';

interface ServerPaginationProps {
  currentPage: number;
  totalPages: number;
  /** Pure-server pagination: each page link is a regular href, so the
   *  caller computes the URL for any given page. We only need the
   *  function, no router state. */
  hrefForPage: (page: number) => string;
  /** Optional aria-label for the nav (e.g. "Activity pagination"). */
  ariaLabel?: string;
}

/**
 * Server-rendered pagination strip. Pure links — no client state,
 * no hooks. Each click is a normal navigation that reuses the
 * server-component data fetch with the new ?page= param, so we only
 * read the slice of rows the user is currently looking at.
 *
 * Hidden entirely when there's a single page. Shows current page /
 * total + previous / next chevrons. For lists with many pages we
 * fold the middle with an ellipsis row matching the existing
 * pagination patterns in the app.
 */
export function ServerPagination({
  currentPage,
  totalPages,
  hrefForPage,
  ariaLabel
}: ServerPaginationProps) {
  if (totalPages <= 1) return null;
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const prev = safePage > 1 ? safePage - 1 : null;
  const next = safePage < totalPages ? safePage + 1 : null;
  const pages = pageRange(safePage, totalPages);

  return (
    <nav
      aria-label={ariaLabel ?? 'Pagination'}
      className="flex items-center justify-center gap-1.5 pt-2"
    >
      <PagerLink
        href={prev ? hrefForPage(prev) : null}
        ariaLabel="Previous page"
        disabled={prev === null}
      >
        <ChevronLeft className="size-3.5" aria-hidden />
      </PagerLink>
      {pages.map((entry, i) =>
        entry === 'ellipsis' ? (
          <span
            key={`e-${i}`}
            className="px-2 text-xs text-[var(--muted)] select-none"
          >
            …
          </span>
        ) : (
          <PagerLink
            key={entry}
            href={hrefForPage(entry)}
            isActive={entry === safePage}
          >
            {entry}
          </PagerLink>
        )
      )}
      <PagerLink
        href={next ? hrefForPage(next) : null}
        ariaLabel="Next page"
        disabled={next === null}
      >
        <ChevronRight className="size-3.5" aria-hidden />
      </PagerLink>
    </nav>
  );
}

function PagerLink({
  href,
  isActive,
  disabled,
  ariaLabel,
  children
}: {
  href: string | null;
  isActive?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const base =
    'min-w-7 h-7 px-2 inline-flex items-center justify-center rounded-md text-xs font-medium tabular-nums transition-colors';
  const variant = isActive
    ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
    : disabled
      ? 'text-[var(--muted)]/40 cursor-not-allowed'
      : 'text-[var(--muted)] hover:bg-[var(--default)] hover:text-[var(--foreground)]';

  if (disabled || !href) {
    return (
      <span aria-hidden={!ariaLabel} aria-label={ariaLabel} className={`${base} ${variant}`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      aria-current={isActive ? 'page' : undefined}
      className={`${base} ${variant}`}
    >
      {children}
    </Link>
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
