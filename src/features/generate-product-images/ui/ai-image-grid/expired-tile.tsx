'use client';

import { Spinner } from '@heroui/react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BusyKind } from './types';

interface ExpiredTileProps {
  costPerImage: number;
  isBusy: BusyKind | undefined;
  onDelete: () => void;
  onRegenerate: () => void;
}

export function ExpiredTile({ costPerImage, isBusy, onDelete, onRegenerate }: ExpiredTileProps) {
  const t = useTranslations('AiImageGrid');
  // Completed but the image is gone (retention purge, or a legacy row
  // from before R2 persistence). listProductImageJobs filters these out
  // server-side; this is the client-side backstop between two polls.
  // NOT an error — neutral tile, always dismissible, never dead-ended.
  return (
    <div className="aspect-square rounded-md border border-dashed border-[var(--border)] bg-[var(--default)]/40 flex flex-col items-center justify-center gap-1 p-3 text-center relative">
      <span className="text-xs text-[var(--muted)]">{t('expiredLabel')}</span>
      <button
        type="button"
        onClick={onRegenerate}
        className="text-[10px] uppercase tracking-wider text-[var(--accent)] hover:underline mt-1"
      >
        {t('retryWithCost', { cost: costPerImage })}
      </button>
      <button
        type="button"
        onClick={onDelete}
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
    </div>
  );
}
