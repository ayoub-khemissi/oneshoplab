'use client';

import { Card } from '@heroui/react';
import { AlertTriangle, Clock, EyeOff, ListChecks, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/shared/lib';
import { cancelChangeAction, dismissChangeAction } from '../api/actions';
import type { PendingChangeSummary } from '../model/types';

export function PendingChangesList({
  siteId,
  initialItems
}: {
  siteId: string;
  initialItems: PendingChangeSummary[];
}) {
  const t = useTranslations('ApplyToStore');
  const tPending = useTranslations('PendingChanges');
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function withdraw(changeId: string) {
    const fd = new FormData();
    fd.set('projectId', siteId);
    fd.set('changeId', changeId);
    setBusyId(changeId);
    startTransition(async () => {
      const res = await cancelChangeAction(fd);
      if (res.ok) setItems((prev) => prev.filter((c) => c.id !== changeId));
      setBusyId(null);
    });
  }

  function dismiss(changeId: string) {
    const fd = new FormData();
    fd.set('projectId', siteId);
    fd.set('changeId', changeId);
    setBusyId(changeId);
    startTransition(async () => {
      const res = await dismissChangeAction(fd);
      if (res.ok) setItems((prev) => prev.filter((c) => c.id !== changeId));
      setBusyId(null);
    });
  }

  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] inline-flex items-center gap-2">
          <ListChecks className="size-3.5" aria-hidden /> {t('listTitle')}
        </span>
        <p className="text-xs text-[var(--muted)] leading-relaxed">{t('listHint')}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)] italic">{t('listEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-2 p-3 rounded-md bg-[var(--default)]/40 border border-[var(--border)] text-sm sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium shrink-0 min-w-[5.5rem]">
                  {t(`field.${c.field}`)}
                </span>
                <Link
                  href={`/dashboard/sites/${siteId}/products/${c.productId}`}
                  className="min-w-0 flex-1 truncate hover:text-[var(--accent)]"
                >
                  {c.productTitle}
                </Link>
              </div>
              <div className="flex min-w-0 items-start gap-2 sm:shrink-0">
                <span className="text-[11px] text-[var(--muted)] inline-flex min-w-0 items-start gap-1 break-words sm:max-w-[18rem]">
                  {c.status === 'conflict' || c.status === 'failed' ? (
                    <AlertTriangle
                      className="size-3 shrink-0 translate-y-0.5 text-[var(--danger)]"
                      aria-hidden
                    />
                  ) : (
                    <Clock className="size-3 shrink-0 translate-y-0.5" aria-hidden />
                  )}
                  {c.status === 'conflict'
                    ? t('conflict')
                    : c.status === 'failed'
                      ? t('failed', { error: c.error ? ` — ${c.error}` : '' })
                      : t('approvedOn', { date: formatDate(c.approvedAtIso) })}
                </span>
                {c.status === 'failed' || c.status === 'conflict' ? (
                  <button
                    type="button"
                    onClick={() => dismiss(c.id)}
                    disabled={busyId === c.id}
                    aria-label={tPending('dismiss')}
                    title={tPending('dismissHint')}
                    className="size-7 shrink-0 rounded-md text-[var(--muted)] hover:bg-[var(--default)] hover:text-[var(--foreground)] inline-flex items-center justify-center disabled:opacity-50"
                  >
                    <EyeOff className="size-3.5" />
                  </button>
                ) : null}
                {c.status === 'pending' ? (
                  <button
                    type="button"
                    onClick={() => withdraw(c.id)}
                    disabled={busyId === c.id}
                    aria-label={t('cancel')}
                    title={t('cancel')}
                    className="size-7 shrink-0 rounded-md hover:bg-[var(--default)] hover:text-[var(--danger)] inline-flex items-center justify-center disabled:opacity-50"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
