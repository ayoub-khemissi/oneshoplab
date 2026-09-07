/**
 * The key a generation is filed under: `jobs.input_payload.productSourceId`.
 *
 * It must be the PRODUCT ROW's key — `sourceId`, else `handle`, else the row
 * id — and it must be the same rule everywhere. The product page files its
 * history under the row's key; for a while the single-generation route and the
 * bulk worker filed theirs under the AUDIT SNAPSHOT's key instead. On a
 * connected Wix store the snapshot comes from a storefront scrape with no
 * source id and falls back to the handle, while the row carries the platform
 * id — so a title was generated, paid for, pushed as a notification, and never
 * shown on the page that had asked for it.
 */
export function productSourceKey(row: {
  id: string;
  sourceId?: string | null;
  handle?: string | null;
}): string {
  return row.sourceId ?? row.handle ?? row.id;
}
