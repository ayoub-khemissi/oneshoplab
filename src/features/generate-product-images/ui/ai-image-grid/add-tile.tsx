'use client';

import { Coins, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface AddTileProps {
  costPerImage: number;
  onClick: () => void;
}

/** Add tile — dashed border + "+" + cost label. */
export function AddTile({ costPerImage, onClick }: AddTileProps) {
  const t = useTranslations('AiImageGrid');
  return (
    <button
      type="button"
      onClick={onClick}
      className="aspect-square rounded-md border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors flex flex-col items-center justify-center gap-1.5 text-[var(--muted)] hover:text-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
    >
      <Plus className="size-6" aria-hidden />
      <span className="text-xs font-medium">{t('addImage')}</span>
      <span className="text-[10px] font-mono uppercase tracking-wider inline-flex items-center gap-1">
        <Coins className="size-3" aria-hidden />
        {costPerImage}
      </span>
    </button>
  );
}
