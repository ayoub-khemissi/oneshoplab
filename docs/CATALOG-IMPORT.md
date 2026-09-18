# Catalogue import (CSV)

Merchant-facing import of products from a spreadsheet, for **"my own store"
projects only** (`projects.source = 'manual'`). A connected Shopify, Wix or
WooCommerce catalogue belongs to the store upstream; importing into it would
fight the sync, so those projects get a 404 from the import routes and an
inert panel on the hub.

Entry point: the header button leads to `/dashboard/sites/<id>/csv`, two
equal panels — import (`/import`) and export (`/export`, see
CATALOG-EXPORT.md). Single-product flavour: on `/products/new`, "Fill from a
CSV" loads the first valid row into the creation form; the form's own action
saves it, so there is no second write path.

## The four steps

1. **File.** One CSV/TSV, up to `IMPORT_LIMITS.maxBytes` (5 MB) and
   `maxRows` (5000). The browser reads it as text — nothing is uploaded yet —
   detects the delimiter (comma, semicolon, tab; overridable) and shows the
   header, the row count and file-level issues.
2. **Columns.** Each header is auto-mapped by alias (our own export headers,
   plus French and English spreadsheet vocabulary — `model/fields.ts`). The
   merchant can remap or ignore any column. A `title` mapping is required.
3. **Check.** `POST /api/projects/<id>/import/preview` re-parses the text on
   the server and returns, per row: create / update / skip / reject, with
   reasons. Nothing is written.
4. **Confirm.** `POST /api/projects/<id>/import/commit` recomputes the same
   plan and writes it. The preview is never an input — it was a forecast of
   this computation.

## Rules

- **Matching** (`lib/dedupe.ts`): SKU, then handle, then normalised title. A
  match is an **update**, never a duplicate; a re-import of the same file is
  therefore idempotent. A second row for the same product inside one file is
  skipped (`duplicate_in_file`).
- **Images.** A new product needs at least one image (the manual-catalogue
  rule). Only `https` links are accepted. The product is created at once with
  the external link; `image_mirror_queue` + the worker pass
  `mirrorQueuedImages` (entities/product) then copy each image to R2 under
  `products/<projectId>/` and rewrite `products.images[].src`. Three failed
  attempts leave the row `failed` and the product keeps its link — visible,
  never silently dropped.
- **Plan ceiling.** `room = maxProductsForPlan(plan) - active products`.
  Creates beyond it are skipped as `plan_limit` and counted in `overLimit`.
- **Updates without images** keep the existing gallery.

## Coercions (`lib/normalize.ts`)

Prices: `24.00`, `24,00`, `€24`, `1 299,90`, `1,299.90` all parse; the last
separator is the decimal one. Tags and image lists split on ` | ` (our
export) or commas. Currency: 3-letter code, `€ $ £` mapped. Too-long values
are **truncated with a warning**, not rejected; a missing title, an invalid
price, a `priceMax` below `price`, an unknown currency or a bad image link
**reject the row**.

## Security

- Ownership + manual-only, checked before the body is read. 404, not 403.
- Rate limit per user: 5 imports, one back every 10 minutes (`IMPORT_BUCKET`).
- Body cap `IMPORT_BODY_MAX_BYTES`; the parser bounds bytes, rows, columns
  and cell length independently.
- **Description HTML is sanitised** (`sanitize-html`, allow-list: paragraphs,
  lists, emphasis, headings, links with http/https/mailto only, `rel`
  forced). Plain text becomes `<p>` paragraphs. This is the import-side
  counterpart of the export's formula-injection guard.
- **Image fetching is hardened** (`shared/lib/safe-fetch.ts`): https only,
  private/loopback/link-local IPs refused (literal and after DNS resolution),
  redirects refused, image content types only, size cap enforced while
  streaming, timeout. Never `uploadFromUrl`, which has none of these.
- No file ever touches the disk: the text is parsed in memory, on both sides.

## Performance

Two queries per plan regardless of file size (existing match keys, active
count); inserts in batches of 200; updates one by one under the project's
sync lock (`withProjectSyncLock`), so a plugin batch or a second import waits
instead of racing. The score is refreshed once at the end
(`recomputeManualAudit`), best effort.

## Tests

`tests/unit/import-parse-csv.test.ts` (parser), `tests/unit/import-normalize.test.ts`
(mapping, coercions, sanitiser, dedupe plan), `tests/unit/safe-fetch.test.ts`
(every guard), `tests/db/import-catalog.test.ts` (preview, commit, re-import,
plan ceiling, XSS, routes: 401/404/413/429), `tests/db/image-mirror.test.ts`
(queue, rewrite, retries, concurrency), `e2e/import-catalog.spec.ts` (hub,
wizard end to end, prefill, 404, phone layout).
