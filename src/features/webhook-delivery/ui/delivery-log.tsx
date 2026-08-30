'use client';

import { useTranslations } from 'next-intl';
import type { WebhookDeliveryView } from '@/entities/outbound-webhook';
import { formatDate } from '@/shared/lib';

/** Last deliveries of the project (newest first): date, event, status, response code. */
export function DeliveryLog({ deliveries }: { deliveries: WebhookDeliveryView[] }) {
  const t = useTranslations('Integrations.webhooks');
  if (deliveries.length === 0) {
    return <p className="text-xs text-[var(--muted)] italic">{t('logEmpty')}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid="webhook-delivery-log">
        <thead>
          <tr className="text-left text-[var(--muted)]">
            <th className="py-1 pr-3 font-medium">{t('logDate')}</th>
            <th className="py-1 pr-3 font-medium">{t('logEvent')}</th>
            <th className="py-1 pr-3 font-medium">{t('logStatus')}</th>
            <th className="py-1 font-medium">{t('logResponse')}</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.id} className="border-t border-[var(--border)]">
              <td className="py-1 pr-3 whitespace-nowrap">{formatDate(d.createdAt)}</td>
              <td className="py-1 pr-3 font-mono">{d.event}</td>
              <td className="py-1 pr-3">
                <DeliveryStatus status={d.status} />
              </td>
              <td className="py-1 font-mono">{d.responseStatus ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeliveryStatus({ status }: { status: WebhookDeliveryView['status'] }) {
  const t = useTranslations('Integrations.webhooks');
  const tone =
    status === 'delivered'
      ? 'text-[var(--success)]'
      : status === 'pending'
        ? 'text-[var(--muted)]'
        : 'text-[var(--danger)]';
  return (
    <span className={`font-medium ${tone}`} data-delivery-status={status}>
      {t(`deliveryStatus.${status}`)}
    </span>
  );
}
