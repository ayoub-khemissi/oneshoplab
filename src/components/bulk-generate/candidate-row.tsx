'use client';

import { Coins } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { BulkCandidate, FieldKey } from '@/components/bulk-generate/types';

export interface CandidateRowProps {
  candidate: BulkCandidate;
  selected: boolean;
  enabled: boolean;
  onToggle: () => void;
}

export function CandidateRow({ candidate, selected, enabled, onToggle }: CandidateRowProps) {
  const t = useTranslations('BulkGenerate');
  const locale = useLocale();
  const fieldLabel: Record<FieldKey, string> = {
    title: t('fieldTitle'),
    description: t('fieldDescription'),
    tags: t('fieldTags'),
    images: t('fieldImages')
  };
  return (
    <label
      className={`flex items-center gap-3 px-5 py-3 hover:bg-[var(--default)]/40 ${
        enabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
      } ${selected ? 'bg-[var(--accent)]/5' : ''}`}
      title={!enabled ? t('rowDisabledHint') : undefined}
    >
      <input
        id={`bulk-candidate-${candidate.id}`}
        type="checkbox"
        checked={selected}
        disabled={!enabled}
        onChange={onToggle}
        className="size-4 accent-[var(--accent)] cursor-pointer disabled:cursor-not-allowed"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-medium text-[var(--foreground)] truncate">
          {candidate.title}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {candidate.pendingFields.map((f) => (
            <span
              key={f}
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--default)] text-[var(--muted)] font-mono"
            >
              {fieldLabel[f]}
            </span>
          ))}
        </div>
      </div>
      <span className="text-xs font-mono tabular-nums text-[var(--muted)] shrink-0 inline-flex items-center gap-1">
        <Coins className="size-3" aria-hidden />
        {candidate.pendingCost.toLocaleString(locale)}
      </span>
    </label>
  );
}
