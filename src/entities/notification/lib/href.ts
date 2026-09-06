import type { NotificationRow } from '../api/notifications';

/**
 * The element a notice is really about, on the page it leads to.
 *
 * Landing on the right page is not the same as landing on the right thing: a
 * product page is long, and "your title is ready" dropped the merchant at the
 * top of it to go hunting for the row that changed. These fragments name the
 * anchors the pages render, so the tap ends on the generation itself.
 *
 * Kept beside the href because the two are one decision: adding a notice kind
 * means answering "where does this land" once, for the bell and the push
 * alike. The ids live in `docs/api/` nowhere — they are asserted by
 * `tests/unit/notification-href.test.ts` against the source that renders them.
 */
const CHAT_FIELDS = new Set(['title', 'description', 'tags']);

function anchorFor(
  kind: string,
  payload: Record<string, unknown> | null | undefined
): string | null {
  const field = payload && typeof payload.field === 'string' ? payload.field : null;
  if (kind === 'chat_completed' || kind === 'chat_failed') {
    // `images` reaches us through the same kind on some paths; it belongs with
    // the photos, not with a text row that does not exist.
    if (field && CHAT_FIELDS.has(field)) return `field-${field}`;
    if (field === 'images') return 'field-images';
    return null;
  }
  if (kind === 'image_completed' || kind === 'image_failed') return 'field-images';
  if (kind === 'audit_completed') return 'site-score';
  return null;
}

/**
 * Where a notice leads. Shared by the bell and by the push notification, so a
 * tap on a lock screen lands exactly where a click in the panel would — the
 * path only, since the bell navigates inside the app and the push prefixes it
 * with the origin.
 */
export function notificationHref(
  row: Pick<NotificationRow, 'kind' | 'projectId' | 'productId' | 'auditId'> & {
    payload?: Record<string, unknown> | null;
  }
): string | null {
  const hash = anchorFor(row.kind, row.payload);
  const at = (path: string) => (hash ? `${path}#${hash}` : path);

  if (
    (row.kind.startsWith('integration_') || row.kind === 'store_connection_needed') &&
    row.projectId
  ) {
    return `/dashboard/sites/${row.projectId}?tab=integrations`;
  }
  if (row.productId && row.projectId) {
    return at(`/dashboard/sites/${row.projectId}/products/${row.productId}`);
  }
  // A bulk run is about the catalogue, so it opens on the list it rewrote
  // rather than on the store's summary.
  if (row.projectId && (row.kind === 'bulk_completed' || row.kind === 'bulk_failed')) {
    return `/dashboard/sites/${row.projectId}?tab=products`;
  }
  if (row.projectId) return at(`/dashboard/sites/${row.projectId}`);
  if (row.auditId) return '/dashboard';
  return null;
}
