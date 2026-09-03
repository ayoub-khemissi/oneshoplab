import type { NotificationRow } from '../api/notifications';

/**
 * Where a notice leads. Shared by the bell and by the push notification, so a
 * tap on a lock screen lands exactly where a click in the panel would — the
 * path only, since the bell navigates inside the app and the push prefixes it
 * with the origin.
 */
export function notificationHref(
  row: Pick<NotificationRow, 'kind' | 'projectId' | 'productId' | 'auditId'>
): string | null {
  if (row.kind.startsWith('integration_') && row.projectId) {
    return `/dashboard/sites/${row.projectId}?tab=integrations`;
  }
  if (row.productId && row.projectId) {
    return `/dashboard/sites/${row.projectId}/products/${row.productId}`;
  }
  if (row.projectId) return `/dashboard/sites/${row.projectId}`;
  if (row.auditId) return '/dashboard';
  return null;
}
