import { eq } from 'drizzle-orm';
import { ArrowDown, ArrowLeft, ArrowUp, FileSpreadsheet, Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { ExportButton } from '@/features/export-catalog/client';
import {
  COLUMN_BY_KEY,
  exportHref,
  loadExportPage,
  nextSortFor,
  parseExportQuery,
  MAX_EXPORT_ROWS,
  PAGE_SIZE,
  type RawParams
} from '@/features/export-catalog';
import { auth } from '@/entities/user';
import { Link } from '@/i18n/navigation';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';
import { ServerPagination } from '@/shared/ui';
import { ExportToolbar } from './export-toolbar';

export type DashboardExportSearchParams = RawParams;

/** Cells are previews: a description is thousands of characters and would
 *  blow the row height apart. The file always carries the full value. */
const PREVIEW_CHARS = 90;

export async function DashboardExportPage({
  siteId,
  searchParams
}: {
  siteId: string;
  searchParams: DashboardExportSearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, siteId),
    columns: { id: true, userId: true, name: true, domain: true }
  });
  // Someone else's project is indistinguishable from a missing one.
  if (!project || project.userId !== session.user.id) notFound();

  const t = await getTranslations('ExportCatalog');
  const query = parseExportQuery(searchParams);
  const { rows, total, pageCount, page } = await loadExportPage(project.id, query);

  const base = `/dashboard/sites/${project.id}/export`;
  const columns = query.columns.map((k) => COLUMN_BY_KEY.get(k)).filter((c) => c != null);
  const apiBase = `/api/projects/${project.id}/export`;
  // The file ignores pagination: it carries every row matching the filters.
  const apiQuery = exportHref(apiBase, query, { page: 1 });
  const oneProductHref = (id: string) =>
    `${apiQuery}${apiQuery.includes('?') ? '&' : '?'}productId=${encodeURIComponent(id)}`;

  return (
    <main className="w-full max-w-7xl mx-auto px-4 py-6 flex flex-col gap-5 min-w-0">
      <header className="flex flex-col gap-3">
        <Link
          href={`/dashboard/sites/${project.id}?tab=products`}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors w-fit"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t('back')}
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-lg md:text-xl font-semibold inline-flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-[var(--accent)] shrink-0" aria-hidden />
              {t('title')}
            </h1>
            <p className="text-sm text-[var(--muted)]">
              {t('subtitle', { domain: project.domain ?? project.name ?? '' })}
            </p>
          </div>
          <ExportButton href={apiQuery} label={t('exportCsv', { count: total })} />
        </div>
      </header>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-col gap-3 min-w-0">
        <ExportToolbar base={base} query={query} />
        <p className="text-xs text-[var(--muted)] inline-flex items-start gap-1.5">
          <Info className="size-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>{t('docs', { max: MAX_EXPORT_ROWS })}</span>
        </p>
      </section>

      <section className="flex flex-col gap-3 min-w-0">
        <p className="text-sm text-[var(--muted)]" aria-live="polite">
          {t('results', { count: total, page, pages: pageCount })}
        </p>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
            {t('empty')}
          </p>
        ) : (
          <>
            {/* Phones get cards, not a table. A table of eight columns cannot
              fit 390px, and an inner scroller is not enough: Chromium still
              lets the document itself scroll sideways, which turns every
              vertical swipe into a fight with the page. */}
            <ul data-testid="export-cards" className="flex flex-col gap-2 md:hidden">
              {rows.map((row) => {
                const [first, ...rest] = columns;
                return (
                  <li
                    key={row.id}
                    className="rounded-lg border border-[var(--border)] p-3 flex flex-col gap-2 min-w-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm break-words min-w-0">
                        {first ? first.value(row) : row.title}
                      </span>
                      <ExportButton compact href={oneProductHref(row.id)} label={t('exportOne')} />
                    </div>
                    <dl className="flex flex-col gap-1 min-w-0">
                      {rest.map((c) => {
                        const raw = c.value(row);
                        if (!raw) return null;
                        return (
                          <div key={c.key} className="flex items-baseline gap-2 min-w-0 text-xs">
                            <dt className="text-[var(--muted)] shrink-0">{t(`column_${c.key}`)}</dt>
                            <dd className="min-w-0 truncate">{raw}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </li>
                );
              })}
            </ul>

            <div className="hidden md:block w-full min-w-0 overflow-x-auto rounded-lg border border-[var(--border)]">
              <table data-testid="export-table" className="w-full text-sm border-collapse">
                <thead className="bg-[var(--surface)]">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className="text-left font-medium text-xs uppercase tracking-wider text-[var(--muted)] px-3 py-2 whitespace-nowrap"
                      >
                        {c.sortable ? (
                          <Link
                            href={exportHref(base, query, nextSortFor(query, c.key))}
                            className="inline-flex items-center gap-1 hover:text-[var(--accent)] transition-colors"
                            aria-label={t('sortBy', { column: t(`column_${c.key}`) })}
                          >
                            {t(`column_${c.key}`)}
                            {query.sort === c.key ? (
                              query.dir === 'asc' ? (
                                <ArrowUp className="size-3" aria-hidden />
                              ) : (
                                <ArrowDown className="size-3" aria-hidden />
                              )
                            ) : null}
                          </Link>
                        ) : (
                          t(`column_${c.key}`)
                        )}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2 w-12">
                      <span className="sr-only">{t('exportOne')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border)] align-top">
                      {columns.map((c) => {
                        const raw = c.value(row);
                        return (
                          <td
                            key={c.key}
                            className="px-3 py-2 max-w-[22rem]"
                            title={raw.length > PREVIEW_CHARS ? raw : undefined}
                          >
                            <span className="block truncate">
                              {raw.length > PREVIEW_CHARS ? `${raw.slice(0, PREVIEW_CHARS)}…` : raw}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2">
                        <ExportButton
                          compact
                          href={oneProductHref(row.id)}
                          label={t('exportOne')}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <ServerPagination
          currentPage={page}
          totalPages={pageCount}
          ariaLabel={t('pagination')}
          hrefForPage={(p) => exportHref(base, query, { page: p })}
        />
        <p className="sr-only">{t('pageSize', { size: PAGE_SIZE })}</p>
      </section>
    </main>
  );
}
