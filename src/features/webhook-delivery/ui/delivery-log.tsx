'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WebhookDeliveryView } from '@/entities/outbound-webhook';
import { formatDate } from '@/shared/lib';

/** How many rows the log shows before the merchant asks for the rest. */
const VISIBLE_ROWS = 5;

/**
 * Last deliveries of the project (newest first): date, event, status, response
 * code. Only the most recent handful is shown — what a merchant checks here is
 * "did my last change go through", not the whole history.
 */
export function DeliveryLog({ deliveries }: { deliveries: WebhookDeliveryView[] }) {
  const t = useTranslations('Integrations.webhooks');
  const [expanded, setExpanded] = useState(false);
  if (deliveries.length === 0) {
    return <p className="text-xs text-[var(--muted)] italic">{t('logEmpty')}</p>;
  }
  const rows = expanded ? deliveries : deliveries.slice(0, VISIBLE_ROWS);
  const hidden = deliveries.length - rows.length;
  return (
    <div className="flex flex-col gap-2">
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
            {rows.map((d) => (
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
      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid="delivery-log-toggle"
          aria-expanded={expanded}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
          {expanded ? t('logShowLess') : t('logShowMore', { count: hidden })}
        </button>
      ) : null}
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
