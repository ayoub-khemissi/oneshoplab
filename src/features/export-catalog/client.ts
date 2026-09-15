/**
 * Client-safe entry point.
 *
 * The slice's index.ts re-exports the data layer, which reaches @/shared/db
 * and therefore mysql2. A 'use client' component importing that barrel drags
 * the driver into the browser bundle — the build then fails on `net` and
 * `tls`, which is exactly how this file came to exist. Everything below is
 * pure: no database, no server-only API.
 */
export { ExportButton } from './ui/export-button';
export {
  exportHref,
  nextSortFor,
  parseColumns,
  parseExportQuery,
  MAX_EXPORT_ROWS,
  MAX_PAGE,
  PAGE_SIZE
} from './lib/query';
export type { ExportQuery, RawParams, SortDirection, StatusFilter } from './lib/query';
export { csvCell, toCsv, CSV_BOM } from './lib/csv';
export {
  COLUMN_BY_KEY,
  DEFAULT_COLUMN_KEYS,
  EXPORT_COLUMNS,
  type ExportColumn,
  type ExportRow
} from './model/columns';
