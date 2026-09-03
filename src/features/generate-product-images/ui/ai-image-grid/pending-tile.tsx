'use client';

import { Skeleton, Spinner } from '@heroui/react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BusyKind } from './types';
import type { ImageJobRow } from '@/entities/generation-job';

interface PendingTileProps {
  job: ImageJobRow;
  now: number;
  isBusy: BusyKind | undefined;
  onDelete: () => void;
}

/** Pending/running job: skeleton + live elapsed caption. Cancelling skips
 *  the confirm dialog since it's reversible (credits get refunded). */
export function PendingTile({ job, now, isBusy, onDelete }: PendingTileProps) {
  const t = useTranslations('AiImageGrid');
  const startedAt = job.startedAt ?? job.createdAt;
  const elapsedSec = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));
  // After ~90s the generation is taking longer than the kie average.
  // Surface a prominent cancel-and-refund affordance so the merchant
  // doesn't have to wait on the watchdog (which only kicks in at 8min).
  const showSlowBail = elapsedSec >= 90;
  return (
    <div className="aspect-square relative rounded-md overflow-hidden">
      <Skeleton className="absolute inset-0 rounded-md" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none p-3">
        <Spinner size="md" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
          {t('generatingElapsed', { seconds: elapsedSec })}
        </span>
        {showSlowBail ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={isBusy === 'delete'}
            className="pointer-events-auto mt-1 px-2 py-1 rounded text-[10px] uppercase tracking-wider bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors disabled:opacity-50"
          >
            {isBusy === 'delete' ? t('cancellingShort') : t('cancelAndRefund')}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={isBusy === 'delete'}
        aria-label={t('cancel')}
        title={t('cancel')}
        className="absolute top-1.5 right-1.5 size-7 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white disabled:opacity-50"
      >
        {isBusy === 'delete' ? (
          <Spinner size="sm" className="text-white" />
        ) : (
          <X className="size-3.5" />
        )}
      </button>
    </div>
  );
}
