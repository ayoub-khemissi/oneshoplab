import type { NotificationKind } from '@/shared/db/schema';

/** The translator this needs: `getTranslations('Nav')` or `useTranslations('Nav')`. */
interface NavTranslator {
  (key: string): string;
  raw(key: string): string;
}

/**
 * The bell's copy, resolved by the server so the i18n boundary stays out of
 * the client component (both the site header and the embedded header use it).
 */
export function bellLabels(t: NavTranslator) {
  const kinds: Record<NotificationKind, string> = {
    chat_completed: t('notifications.kinds.chat_completed'),
    chat_failed: t('notifications.kinds.chat_failed'),
    image_completed: t('notifications.kinds.image_completed'),
    image_failed: t('notifications.kinds.image_failed'),
    audit_completed: t('notifications.kinds.audit_completed'),
    audit_failed: t('notifications.kinds.audit_failed'),
    store_connection_needed: t('notifications.kinds.store_connection_needed'),
    bulk_completed: t('notifications.kinds.bulk_completed'),
    bulk_failed: t('notifications.kinds.bulk_failed'),
    integration_key_expiring: t('notifications.kinds.integration_key_expiring'),
    integration_key_expired: t('notifications.kinds.integration_key_expired'),
    integration_key_revoked: t('notifications.kinds.integration_key_revoked'),
    integration_token_invalid: t('notifications.kinds.integration_token_invalid'),
    integration_sync_failed: t('notifications.kinds.integration_sync_failed'),
    integration_webhook_disabled: t('notifications.kinds.integration_webhook_disabled')
  };
  return {
    panelTitle: t('notifications.title'),
    emptyState: t('notifications.empty'),
    markAllRead: t('notifications.markAllRead'),
    kinds,
    fieldLabels: {
      title: t('notifications.fieldLabels.title'),
      description: t('notifications.fieldLabels.description'),
      tags: t('notifications.fieldLabels.tags')
    },
    relativeNow: t('notifications.relativeNow'),
    relativeMinutes: t.raw('notifications.relativeMinutes'),
    relativeHours: t.raw('notifications.relativeHours'),
    relativeDays: t.raw('notifications.relativeDays')
  };
}
