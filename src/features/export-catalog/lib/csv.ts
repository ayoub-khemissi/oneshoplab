/**
 * CSV writing, RFC 4180 style, with one addition that matters: formula
 * injection defence.
 *
 * A product title is merchant-controlled text that lands in a file the
 * merchant opens in Excel, Numbers or Sheets. A cell starting with `=`,
 * `+`, `-`, `@`, or a tab/CR is interpreted as a formula by those apps, so
 * `=HYPERLINK("http://evil","click")` in a scraped product name becomes a
 * live payload on the victim's machine. We prefix such cells with a single
 * quote, which spreadsheets strip on display and treat as literal text.
 */

const NEEDS_QUOTING = /[",\n\r]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Escape one cell: neutralise formulas first, then quote if needed. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Join a header + rows into a CSV document with CRLF line endings. */
export function toCsv(header: readonly string[], rows: readonly unknown[][]): string {
  const out = [header.map(csvCell).join(',')];
  for (const row of rows) out.push(row.map(csvCell).join(','));
  // CRLF is what RFC 4180 asks for and what Excel expects on every platform.
  return out.join('\r\n');
}

/**
 * UTF-8 BOM. Without it Excel on Windows reads the file as the local
 * codepage and mangles every accent — "Crème" becomes "CrÃ¨me".
 */
export const CSV_BOM = '﻿';
