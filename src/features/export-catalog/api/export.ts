import { take, type TakeResult } from '@/shared/api';
import { CSV_BOM, toCsv } from '../lib/csv';
import { COLUMN_BY_KEY } from '../model/columns';
import type { ExportRow } from '../model/columns';

/**
 * Download budget: 10 files, refilled at one every three minutes (20/hour
 * sustained). Generous for a merchant checking their catalogue, tight enough
 * that nobody turns the endpoint into a scraping loop against our database.
 * The bucket is keyed per user, not per project, so opening ten sites does
 * not multiply the allowance.
 */
export const EXPORT_BUCKET = { capacity: 10, refillPerSec: 1 / 180 };

export function takeExportToken(userId: string): TakeResult {
  return take(`export:${userId}`, EXPORT_BUCKET);
}

/** Build the CSV document for a set of rows and the merchant's column choice. */
export function buildCatalogCsv(rows: readonly ExportRow[], columnKeys: readonly string[]): string {
  const columns = columnKeys.map((k) => COLUMN_BY_KEY.get(k)).filter((c) => c != null);
  const header = columns.map((c) => c.header);
  const body = rows.map((row) => columns.map((c) => safeValue(c.value, row)));
  return CSV_BOM + toCsv(header, body);
}

/**
 * A malformed JSON column (hand-edited, or written by an older importer)
 * must cost that one cell, never the whole download.
 */
function safeValue(read: (row: ExportRow) => string, row: ExportRow): string {
  try {
    return read(row);
  } catch {
    return '';
  }
}

/** `afrometis-com-catalogue-2026-09-15.csv`, safe on every filesystem. */
export function exportFilename(label: string, stamp: Date = new Date()): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'catalogue';
  return `${slug}-${stamp.toISOString().slice(0, 10)}.csv`;
}
