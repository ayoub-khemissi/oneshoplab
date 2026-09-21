'use client';

import { useTranslations } from 'next-intl';
import type { ImageJobRow } from '@/entities/generation-job';
import {
  MODAL_OVERLAY_CLASS,
  modalPanelClass,
  ModalCloseButton,
  useModalHistory
} from '@/shared/ui';

interface ReplacePickerProps {
  jobs: ImageJobRow[];
  max: number;
  onPick: (jobId: string) => void;
  onCancel: () => void;
}

/**
 * The "+" at the cap: instead of a refusal, the six tiles and the question
 * "which one goes?". Picking one opens the generation modal in replace mode
 * — the same path the regenerate button takes.
 */
export function ReplacePicker({ jobs, max, onPick, onCancel }: ReplacePickerProps) {
  const t = useTranslations('AiImageGrid');
  useModalHistory(true, onCancel);
  const candidates = jobs.filter((j) => j.derived !== 'remove_bg');
  return (
    <div role="dialog" aria-modal="true" className={MODAL_OVERLAY_CLASS} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={modalPanelClass('md', 'p-5 gap-4 overflow-y-auto')}
        data-testid="replace-picker"
      >
        <ModalCloseButton onClose={onCancel} />
        <div className="pr-10">
          <h3 className="text-base font-semibold">
            {t('replaceTitle', { count: candidates.length, max })}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">{t('replaceHint')}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {candidates.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => onPick(job.id)}
              aria-label={t('replacePickAria')}
              title={t('replacePickAria')}
              className="aspect-square rounded-md overflow-hidden border-2 border-transparent bg-[var(--default)] hover:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] flex items-center justify-center text-[10px] text-[var(--muted)]"
            >
              {job.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={job.imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="px-1 text-center">{t('failedLabel')}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 rounded-md text-sm hover:bg-[var(--default)]"
          >
            {t('cancelModal')}
          </button>
        </div>
      </div>
    </div>
  );
}
