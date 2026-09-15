# Catalogue export (CSV)

Merchant-facing export of a project's catalogue, at
`/dashboard/sites/<siteId>/export`, served by
`GET /api/projects/<siteId>/export`.

## What the merchant gets

A UTF-8 CSV (BOM included so Excel on Windows reads the accents), comma
separated, CRLF line endings, one line per product. Images are exported as
**links to the merchant's own store**, never as files — the point is a sheet
they can work with, not an archive.

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
