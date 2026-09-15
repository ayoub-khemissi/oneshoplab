import { COLUMN_BY_KEY, DEFAULT_COLUMN_KEYS, EXPORT_COLUMNS } from '../model/columns';

export const PAGE_SIZE = 25;
/** Deep pagination is a scan; nobody browses to page 400 by hand. */
export const MAX_PAGE = 400;
/** Ceiling on one export, independent of the plan's catalogue limit. */
export const MAX_EXPORT_ROWS = 5000;
const MAX_QUERY_LEN = 120;

export type SortDirection = 'asc' | 'desc';
export type StatusFilter = 'active' | 'archived' | 'all';

export interface ExportQuery {
  page: number;
  sort: string;
  dir: SortDirection;
  q: string | null;
  status: StatusFilter;
  columns: string[];
}

export type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : null;
}

const SORTABLE = new Set(EXPORT_COLUMNS.filter((c) => c.sortable).map((c) => c.key));

/**
 * Turn untrusted search params into a query the data layer can execute.
 *
 * Everything is whitelisted rather than sanitised: `sort` must name a column
 * this module already knows is sortable, `columns` are intersected with the
 * catalogue, and the page is clamped. Nothing here is ever interpolated into
 * SQL — the caller maps these keys to drizzle column objects — so an unknown
 * value can only ever fall back to a default, never reach the database.
 */
export function parseExportQuery(params: RawParams): ExportQuery {
  const pageRaw = Number.parseInt(first(params.page) ?? '', 10);
  const page = Number.isFinite(pageRaw) ? Math.min(Math.max(pageRaw, 1), MAX_PAGE) : 1;

  const sortRaw = first(params.sort) ?? '';
  const sort = SORTABLE.has(sortRaw) ? sortRaw : 'updatedAt';

  const dir: SortDirection = first(params.dir) === 'asc' ? 'asc' : 'desc';

  const qRaw = (first(params.q) ?? '').trim().slice(0, MAX_QUERY_LEN);
  const q = qRaw.length > 0 ? qRaw : null;

  const statusRaw = first(params.status);
  const status: StatusFilter =
    statusRaw === 'archived' ? 'archived' : statusRaw === 'all' ? 'all' : 'active';

  const columns = parseColumns(first(params.columns));

  return { page, sort, dir, q, status, columns };
}

/** Comma-separated keys → known columns, order preserved, duplicates dropped. */
export function parseColumns(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_COLUMN_KEYS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of raw.split(',')) {
    const k = key.trim();
    if (!COLUMN_BY_KEY.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.length > 0 ? out : [...DEFAULT_COLUMN_KEYS];
}

/** Rebuild the page URL, dropping defaults so shared links stay readable. */
export function exportHref(
  base: string,
  query: ExportQuery,
  overrides: Partial<ExportQuery> = {}
): string {
  const q = { ...query, ...overrides };
  const sp = new URLSearchParams();
  if (q.page > 1) sp.set('page', String(q.page));
  if (q.sort !== 'updatedAt') sp.set('sort', q.sort);
  if (q.dir !== 'desc') sp.set('dir', q.dir);
  if (q.q) sp.set('q', q.q);
  if (q.status !== 'active') sp.set('status', q.status);
  const cols = q.columns.join(',');
  if (cols !== DEFAULT_COLUMN_KEYS.join(',')) sp.set('columns', cols);
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/** Clicking a sortable header: same column flips direction, new column starts desc. */
export function nextSortFor(query: ExportQuery, key: string): Partial<ExportQuery> {
  if (!SORTABLE.has(key)) return {};
  if (query.sort !== key) return { sort: key, dir: 'desc', page: 1 };
  return { sort: key, dir: query.dir === 'desc' ? 'asc' : 'desc', page: 1 };
}
