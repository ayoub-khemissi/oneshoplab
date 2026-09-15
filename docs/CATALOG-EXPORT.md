# Catalogue export (CSV)

Merchant-facing export of a project's catalogue, at
`/dashboard/sites/<siteId>/export`, served by
`GET /api/projects/<siteId>/export`.

## What the merchant gets

A UTF-8 file (BOM included so Excel on Windows reads the accents), CRLF line
endings, one line per product. Images are exported as **links to the
merchant's own store**, never as files — the point is a sheet they can work
with, not an archive.

## Separator, and why it is a choice

"CSV" is not one format. Excel splits on the list separator of the machine's
locale: a comma on an English Windows, a **semicolon** on a French, German,
Spanish or Italian one. Hand a French merchant a comma file and every row
lands in a single column, so `sep=comma|semicolon|tab` is part of the view
(URL, like the columns) and drives three things at once:

- **Quoting.** A field is quoted when it contains the *active* separator, a
  double quote, or a line break — and only then. A comma inside a semicolon
  file is an ordinary character; hard-coding the rule to `,` would both add
  noise and, the day the separator changed, shift a whole column silently.
  Quotes inside a quoted field are doubled (`""`), per RFC 4180.
- **Extension.** `.tsv` for tab, `.csv` otherwise.
- **Content type.** `text/tab-separated-values` for tab, `text/csv` otherwise.

Values that are NOT the merchant's problem: multi-value cells (image links,
tags, variant SKUs) are joined with `" | "`, which survives every separator;
`null` becomes an empty field; dates are ISO-8601.

One thing deliberately left alone: decimal separators. Prices are written as
stored (`24.00`). A European Excel reading a semicolon file may treat that as
text rather than a number. Rewriting `.` to `,` would change the data, not
just its packaging, so it is the merchant's call in the spreadsheet.

## Shape of the page

- 25 products per page, server-side. Pagination, sorting and filtering all
  live in the URL, so a view can be reloaded, bookmarked or shared.
- Sorting is offered only on columns backed by a real SQL column
  (`EXPORT_COLUMNS[].sortable`); anything computed from a JSON column would
  mean a full scan. Every sort carries `products.id` as a tie-break, without
  which equal titles can swap between two pages and show a duplicate on one
  and a hole on the next.
- Search matches title, SKU and vendor. `%` and `_` typed by the merchant are
  escaped: they are characters, not wildcards.
- The column picker writes to the URL as well. An empty selection is
  impossible — it falls back to `DEFAULT_COLUMN_KEYS`.

## Adding a column

Add one entry to `EXPORT_COLUMNS` in
`src/features/export-catalog/model/columns.ts` (key, CSV header, accessor,
`inTable`, `sortable`), add the label under `ExportCatalog.column_<key>` in
the 13 message catalogues, and — if it is sortable — map it in `SORT_COLUMNS`
in `api/list.ts`. Nothing else reads column keys: a key absent from the
catalogue cannot reach the database or the file.

## Limits and abuse

- `MAX_EXPORT_ROWS` (5000) caps one file. The document is built in memory and
  returned as one response.
- `MAX_PAGE` (400) caps the offset: nobody browses to page 401 by hand.
- Downloads are rate limited per **user** (`EXPORT_BUCKET`: 10 files, one
  refilled every three minutes). Keyed per user rather than per project so
  opening ten sites does not multiply the allowance. A refused download
  answers 429 with `Retry-After`, and the button shows the delay instead of
  navigating the merchant to a JSON error.

## Security notes

- The session must own the project. A project owned by somebody else answers
  **404**, not 403 — a 403 would confirm the id exists.
- Cells are protected against spreadsheet formula injection: a value starting
  with `=`, `+`, `-`, `@`, tab or CR is prefixed with a single quote, so a
  product name scraped from a store cannot execute in Excel, Numbers or
  Sheets.
- Responses are `no-store, private` with `nosniff` and `noindex`: a
  merchant's catalogue must never sit in a shared cache or a search index.
