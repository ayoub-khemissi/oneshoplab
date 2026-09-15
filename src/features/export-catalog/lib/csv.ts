/**
 * CSV writing, RFC 4180 style, with two additions that matter in practice:
 * a choice of separator, and formula injection defence.
 *
 * Separator, because "CSV" is not one format. Excel reads a file with the
 * list separator of the machine's locale: comma on an English Windows,
 * semicolon on a French, German, Spanish or Italian one. Hand a French
 * merchant a comma file and every row lands in a single column. The tab
 * variant is there for the tools that ask for TSV.
 *
 * Formula injection, because a product title is merchant-controlled text
 * that ends up in a file opened by a spreadsheet. A cell starting with `=`,
 * `+`, `-`, `@`, or a tab/CR is executed as a formula by Excel, Numbers and
 * Sheets, so `=HYPERLINK("http://evil","click")` in a scraped product name
 * becomes a live payload. Such cells are prefixed with a single quote,
 * which spreadsheets strip on display and treat as literal text.
 */

export type CsvSeparatorId = 'comma' | 'semicolon' | 'tab';

export const CSV_SEPARATORS: Record<CsvSeparatorId, string> = {
  comma: ',',
  semicolon: ';',
  tab: '\t'
};

export const DEFAULT_SEPARATOR: CsvSeparatorId = 'comma';

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Escape one cell for the separator in use.
 *
 * A field is quoted when it holds the ACTIVE separator, a double quote, or
 * a line break — and only then. A comma inside a semicolon-separated file
 * needs no quoting, which is why the rule cannot be hard-coded to `,`.
 */
export function csvCell(value: unknown, separator: string = CSV_SEPARATORS.comma): string {
  let s = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  const mustQuote = s.includes(separator) || s.includes('"') || /[\n\r]/.test(s);
  return mustQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Join a header + rows into a document with CRLF line endings. */
export function toCsv(
  header: readonly string[],
  rows: readonly unknown[][],
  separatorId: CsvSeparatorId = DEFAULT_SEPARATOR
): string {
  const sep = CSV_SEPARATORS[separatorId] ?? CSV_SEPARATORS.comma;
  const out = [header.map((h) => csvCell(h, sep)).join(sep)];
  for (const row of rows) out.push(row.map((c) => csvCell(c, sep)).join(sep));
  // CRLF is what RFC 4180 asks for and what Excel expects on every platform.
  return out.join('\r\n');
}

/**
 * UTF-8 BOM. Without it Excel on Windows reads the file as the local
 * codepage and mangles every accent — "Crème" becomes "CrÃ¨me".
 */
export const CSV_BOM = '﻿';

/** Tab-separated files are conventionally .tsv, and served as such. */
export function csvFileExtension(separatorId: CsvSeparatorId): 'csv' | 'tsv' {
  return separatorId === 'tab' ? 'tsv' : 'csv';
}

export function csvContentType(separatorId: CsvSeparatorId): string {
  return separatorId === 'tab'
    ? 'text/tab-separated-values; charset=utf-8'
    : 'text/csv; charset=utf-8';
}
