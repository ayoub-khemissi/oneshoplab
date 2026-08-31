'use client';

import { AlertTriangle, Bell, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { InfoHint } from '@/shared/ui';
import type { PendingChangeItem, PendingCounts } from '../model/types';
import { PendingChangesModal } from './pending-changes-modal';

export interface PendingChangesBannerProps {
  projectId: string;
  counts: PendingCounts;
  items: PendingChangeItem[];
  /** `product` speaks about this product, `site` about the whole store. */
  scope: 'product' | 'site';
}

/**
 * The spontaneous signal: a merchant who never opens the Integrations tab still
 * sees that work is waiting for their store. It opens nothing by itself — the
 * recap is one click away, never in the way.
 */
export function PendingChangesBanner({
  projectId,
  counts,
  items,
  scope
}: PendingChangesBannerProps) {
  const t = useTranslations('PendingChanges');
  const [open, setOpen] = useState(false);

  if (counts.total === 0) return null;

  const tone =
    counts.failed > 0
      ? 'border-[var(--danger)]/40 bg-[var(--danger)]/5'
      : counts.conflict > 0
        ? 'border-[var(--warning,var(--danger))]/40 bg-[var(--warning,var(--danger))]/5'
        : 'border-[var(--accent)]/40 bg-[var(--accent)]/5';

  return (
    <div
      data-testid="pending-changes-banner"
      data-count={counts.total}
      className={`flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:flex-wrap sm:items-center ${tone}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {counts.failed > 0 ? (
          <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" aria-hidden />
        ) : counts.conflict > 0 ? (
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-[var(--warning,var(--danger))]"
            aria-hidden
          />
        ) : (
          <Bell className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" aria-hidden />
        )}

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">
            {scope === 'product'
              ? t('bannerProduct', { count: counts.total })
              : t('bannerSite', { count: counts.total })}{' '}
            <InfoHint topic="pendingSync" label={t('open')} />
          </span>
          {counts.failed > 0 || counts.conflict > 0 ? (
            <span className="text-xs text-[var(--muted)]">
              {counts.failed > 0 ? t('bannerFailed', { count: counts.failed }) : null}
              {counts.failed > 0 && counts.conflict > 0 ? ' · ' : null}
              {counts.conflict > 0 ? t('bannerConflicts', { count: counts.conflict }) : null}
            </span>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="pending-changes-open"
        className="w-full shrink-0 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 sm:w-auto sm:py-1.5"
      >
        {t('open')}
      </button>

      <PendingChangesModal
        isOpen={open}
        onOpenChange={setOpen}
        projectId={projectId}
        items={items}
      />
    </div>
  );
}
