'use client';

import { AlertTriangle, ArrowRight, Clock, RotateCcw, X, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/shared/lib';
import { imageOpDescriptions } from '../lib/pending-summary';
import type { PendingChangeDetail, PendingChangeItem } from '../model/types';

/** The change's content in the merchant's words: text before/after, or the photo ops. */
function ChangeDetail({ detail }: { detail: PendingChangeDetail }) {
  const t = useTranslations('PendingChanges');
  const tImages = useTranslations('ProductImages');

  if (detail.kind === 'imageReplaceAll') {
    return (
      <p className="text-sm text-[var(--foreground)]">
        {t('imagesReplaceAll', { before: detail.before, after: detail.after })}
      </p>
    );
  }

  if (detail.kind === 'imageOps') {
    const descriptions = imageOpDescriptions(detail.ops, detail.prior, {
      photo: (n) => tImages('photoLabel', { n }),
      added: t('newPhoto')
    });
    return (
      <ul className="flex flex-col gap-0.5 text-sm">
        {descriptions.map((d, i) => (
          <li key={`${d.key}-${i}`} className="text-[var(--foreground)]">
            {tImages(d.key, d.values)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-[var(--muted)] line-through decoration-[var(--muted)]/50">
        <span className="mr-1.5 text-[11px] uppercase tracking-wider no-underline">
          {t('before')}
        </span>
        {detail.before ?? t('emptyValue')}
      </p>
      <p className="text-[var(--foreground)]">
        <span className="mr-1.5 text-[11px] uppercase tracking-wider text-[var(--muted)]">
          {t('after')}
        </span>
        {detail.after ?? t('emptyValue')}
      </p>
    </div>
  );
}

export interface PendingChangeRowProps {
  item: PendingChangeItem;
  /** Pending rows only — conflicts and failures carry their own action. */
  selectable: boolean;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onWithdraw: () => void;
  onRetry: () => void;
}

/**
 * One waiting change. The status decides the affordance: a pending one can be
 * withdrawn, a conflict sends the merchant to the product (their store moved,
 * nothing to replay blindly), a failure offers the same send again.
 */
export function PendingChangeRow({
  item,
  selectable,
  selected,
  busy,
  onToggle,
  onWithdraw,
  onRetry
}: PendingChangeRowProps) {
  const t = useTranslations('PendingChanges');
  const tField = useTranslations('ApplyToStore');
  const tone =
    item.status === 'conflict'
      ? 'border-[var(--warning,var(--danger))]/40 bg-[var(--warning,var(--danger))]/5'
      : item.status === 'failed'
        ? 'border-[var(--danger)]/40 bg-[var(--danger)]/5'
        : 'border-[var(--border)] bg-[var(--default)]/30';

  return (
    <li
      data-testid="pending-change-row"
      data-status={item.status}
      data-change-id={item.id}
      className={`flex items-start gap-3 rounded-md border p-3 ${tone}`}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={busy}
          aria-label={t('selectRow', { field: tField(`field.${item.field}`) })}
          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            {tField(`field.${item.field}`)}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
            {item.status === 'pending' ? (
              <Clock className="size-3" aria-hidden />
            ) : item.status === 'conflict' ? (
              <AlertTriangle className="size-3 text-[var(--warning,var(--danger))]" aria-hidden />
            ) : (
              <XCircle className="size-3 text-[var(--danger)]" aria-hidden />
            )}
            {t('approvedOn', { date: formatDate(item.approvedAtIso) })}
          </span>
        </div>

        <ChangeDetail detail={item.detail} />

        {item.status === 'conflict' ? (
          <p className="text-xs text-[var(--muted)]">{t('conflictHint')}</p>
        ) : null}
        {item.status === 'failed' ? (
          <p className="text-xs text-[var(--danger)]">
            {item.error ? t('failureError', { error: item.error }) : t('failureNoError')}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {item.status === 'conflict' ? (
          <Link
            href={`/dashboard/sites/${item.projectId}/products/${item.productId}`}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {t('review')} <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : null}
        {item.status === 'failed' && item.retryable ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            data-testid="pending-retry"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            <RotateCcw className="size-3" aria-hidden /> {t('retry')}
          </button>
        ) : null}
        {item.status === 'pending' ? (
          <button
            type="button"
            onClick={onWithdraw}
            disabled={busy}
            data-testid="pending-withdraw"
            aria-label={t('remove')}
            title={t('remove')}
            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-[var(--default)] hover:text-[var(--danger)] disabled:opacity-50"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </li>
  );
}
