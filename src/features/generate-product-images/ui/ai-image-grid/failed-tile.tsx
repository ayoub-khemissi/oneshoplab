'use client';

import { Spinner } from '@heroui/react';
import { AlertTriangle, Coins, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BusyKind } from './types';
import { ConfirmDialog } from '@/shared/ui';
import type { ImageJobRow } from '@/entities/generation-job';

interface FailedTileProps {
  job: ImageJobRow;
  costPerImage: number;
  isBusy: BusyKind | undefined;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  onDelete: () => void;
  onRegenerate: () => void;
}

export function FailedTile({
  job,
  costPerImage,
  isBusy,
  confirmOpen,
  setConfirmOpen,
  onDelete,
  onRegenerate
}: FailedTileProps) {
  const t = useTranslations('AiImageGrid');
  // The job-${id}-refund idempotency key guarantees the credits were
  // refunded exactly once (by whichever path got there first: the
  // synchronous catch in startImageOptim, the kie webhook, the watchdog
  // sweep, or the user's cancel-via-DELETE). We surface that fact here
  // so the merchant sees their balance is whole before deciding whether
  // to spend on a retry.
  return (
    <div className="aspect-square rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex flex-col items-center justify-center gap-1.5 p-3 text-center relative">
      <AlertTriangle className="size-5 text-[var(--danger)]" aria-hidden />
      <span className="text-xs font-medium text-[var(--danger)]">{t('failedLabel')}</span>
      <span className="text-[10px] text-[var(--success)] font-medium inline-flex items-center gap-1">
        <Coins className="size-3" aria-hidden />
        {t('refundedNote', { cost: job.creditsCost })}
      </span>
      <button
        type="button"
        onClick={onRegenerate}
        className="text-[10px] uppercase tracking-wider text-[var(--accent)] hover:underline mt-1"
      >
        {t('retryWithCost', { cost: costPerImage })}
      </button>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={isBusy === 'delete'}
        aria-label={t('delete')}
        title={t('delete')}
        className="absolute top-1.5 right-1.5 size-7 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm flex items-center justify-center text-white disabled:opacity-50"
      >
        {isBusy === 'delete' ? (
          <Spinner size="sm" className="text-white" />
        ) : (
          <X className="size-3.5" />
        )}
      </button>
      <ConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('confirmDeleteTitle')}
        description={t('confirmDeleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        isPending={isBusy === 'delete'}
        onConfirm={onDelete}
      />
    </div>
  );
}
