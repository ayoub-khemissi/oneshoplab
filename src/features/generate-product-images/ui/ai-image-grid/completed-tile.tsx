'use client';

import { Spinner } from '@heroui/react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BusyKind } from './types';
import { ConfirmDialog, ImageZoom } from '@/shared/ui';
import { ImageExpiry } from '../image-expiry';
import type { ImageJobRow } from '@/entities/generation-job';

interface CompletedTileProps {
  job: ImageJobRow;
  url: string;
  costPerImage: number;
  retentionDays: number;
  isBusy: BusyKind | undefined;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  onDelete: () => void;
  onRegenerate: () => void;
}

export function CompletedTile({
  job,
  url,
  costPerImage,
  retentionDays,
  isBusy,
  confirmOpen,
  setConfirmOpen,
  onDelete,
  onRegenerate
}: CompletedTileProps) {
  const t = useTranslations('AiImageGrid');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative group">
        <ImageZoom url={url} alt="Generated" downloadName={`ai-${job.id}.png`} />
        {/* Per-image action overlay: delete + regenerate, hover-revealed */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity z-10">
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
      <div className="flex justify-end">
        <ImageExpiry createdAt={job.createdAt} retentionDays={retentionDays} />
      </div>
    </div>
  );
}
