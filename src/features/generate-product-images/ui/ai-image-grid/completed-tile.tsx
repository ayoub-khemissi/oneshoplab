'use client';

import { Spinner } from '@heroui/react';
import { Coins, Eraser, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BusyKind } from './types';
import { ConfirmDialog, ImageZoom } from '@/shared/ui';
import { ImageExpiry } from '../image-expiry';
import type { ImageJobRow } from '@/entities/generation-job';

interface CompletedTileProps {
  job: ImageJobRow;
  url: string;
  costPerImage: number;
  /** Price of a transparent-background cut-out of this image. */
  costRemoveBg: number;
  retentionDays: number;
  isBusy: BusyKind | undefined;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onRemoveBg: () => void;
}

/** Checkerboard behind a transparent PNG so the merchant sees the cut-out. */
const CHECKERBOARD =
  'bg-[linear-gradient(45deg,var(--border)_25%,transparent_25%,transparent_75%,var(--border)_75%),linear-gradient(45deg,var(--border)_25%,transparent_25%,transparent_75%,var(--border)_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px]';

export function CompletedTile({
  job,
  url,
  costPerImage,
  costRemoveBg,
  retentionDays,
  isBusy,
  confirmOpen,
  setConfirmOpen,
  onDelete,
  onRegenerate,
  onRemoveBg
}: CompletedTileProps) {
  const t = useTranslations('AiImageGrid');
  const isCutout = job.derived === 'remove_bg';
  return (
    <div className="flex flex-col gap-1.5" data-testid={isCutout ? 'cutout-tile' : undefined}>
      <div className={`relative group rounded-md ${isCutout ? CHECKERBOARD : ''}`}>
        <ImageZoom url={url} alt="Generated" downloadName={`ai-${job.id}.png`} />
        {isCutout ? (
          <span className="absolute bottom-1.5 left-1.5 z-10 text-[10px] font-mono uppercase tracking-wider bg-black/60 text-white px-1.5 py-0.5 rounded pointer-events-none">
            {t('transparentBadge')}
          </span>
        ) : null}
        {/* Per-image action overlay: delete + regenerate, hover-revealed */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity z-10">
          {isCutout ? null : (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isBusy === 'regenerate'}
              aria-label={t('regenerateAria', { cost: costPerImage })}
              title={t('regenerateAria', { cost: costPerImage })}
              className="size-7 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center text-white disabled:opacity-50"
            >
              {isBusy === 'regenerate' ? (
                <Spinner size="sm" className="text-white" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isBusy === 'delete'}
            aria-label={t('delete')}
            title={t('delete')}
            className="size-7 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center text-white disabled:opacity-50"
          >
            {isBusy === 'delete' ? (
              <Spinner size="sm" className="text-white" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
        </div>
      </div>
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
      <div className="flex items-center justify-between gap-2 min-w-0">
        {isCutout ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={onRemoveBg}
            disabled={isBusy === 'removebg'}
            aria-label={t('removeBgAria', { cost: costRemoveBg })}
            title={t('removeBgAria', { cost: costRemoveBg })}
            data-testid="remove-bg-button"
            className="inline-flex items-center gap-1 min-w-0 text-[11px] text-[var(--muted)] hover:text-[var(--accent)] disabled:opacity-50 transition-colors"
          >
            {isBusy === 'removebg' ? (
              <Spinner size="sm" />
            ) : (
              <Eraser className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">{t('removeBg')}</span>
            <span className="font-mono inline-flex items-center gap-0.5 shrink-0">
              <Coins className="size-3" aria-hidden />
              {costRemoveBg}
            </span>
          </button>
        )}
        <ImageExpiry createdAt={job.createdAt} retentionDays={retentionDays} />
      </div>
    </div>
  );
}
