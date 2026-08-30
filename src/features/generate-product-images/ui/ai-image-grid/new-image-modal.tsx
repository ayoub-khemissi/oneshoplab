'use client';

import { Spinner } from '@heroui/react';
import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { ImageAngle, NewImagePayload } from './types';

interface NewImageModalProps {
  costPerImage: number;
  isReplace: boolean;
  onCancel: () => void;
  onSubmit: (payload: NewImagePayload) => Promise<boolean>;
}

/** Modal: pick an angle preset OR write a custom prompt, then submit. */
export function NewImageModal({ costPerImage, isReplace, onCancel, onSubmit }: NewImageModalProps) {
  const t = useTranslations('AiImageGrid');
  const [angle, setAngle] = useState<ImageAngle>('lifestyle');
  const [customPrompt, setCustomPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  async function handleSubmit() {
    if (submitting) return;
    if (angle === 'custom' && !customPrompt.trim()) return;
    setSubmitting(true);
    try {
      const ok = await onSubmit({ angle, customPrompt: customPrompt.trim() });
      if (!ok) setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  }

  const angles: Array<{
    id: ImageAngle;
    label: string;
    description: string;
  }> = [
    {
      id: 'lifestyle',
      label: t('angleLifestyleTitle'),
      description: t('angleLifestyleHint')
    },
    {
      id: 'studio',
      label: t('angleStudioTitle'),
      description: t('angleStudioHint')
    },
    {
      id: 'inuse',
      label: t('angleInUseTitle'),
      description: t('angleInUseHint')
    },
    {
      id: 'custom',
      label: t('angleCustomTitle'),
      description: t('angleCustomHint')
    }
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-2xl max-w-md w-full p-5 flex flex-col gap-4"
      >
        <div>
          <h3 className="text-base font-semibold">
            {isReplace ? t('regenerateTitle') : t('newImageTitle')}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">{t('modalSubtitle')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {angles.map((a) => (
            <label
              key={a.id}
              className={`p-3 rounded-md border cursor-pointer transition-colors flex items-start gap-3 ${
                angle === a.id
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] hover:border-[var(--muted)]'
              }`}
            >
              <input
                type="radio"
                name="angle"
                value={a.id}
                checked={angle === a.id}
                onChange={() => setAngle(a.id)}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">{a.label}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5">{a.description}</div>
              </div>
            </label>
          ))}
        </div>
        {angle === 'custom' ? (
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={t('customPromptPlaceholder')}
            maxLength={800}
            rows={3}
            className="w-full text-sm rounded-md border border-[var(--border)] bg-[var(--card)] p-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
            autoFocus
          />
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--muted)] font-mono uppercase tracking-wider inline-flex items-center gap-1">
            <Coins className="size-3" aria-hidden />
            {costPerImage}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2 rounded-md text-sm hover:bg-[var(--default)]"
            >
              {t('cancelModal')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || (angle === 'custom' && !customPrompt.trim())}
              className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting ? <Spinner size="sm" /> : null}
              {isReplace ? t('confirmRegenerate') : t('confirmAdd')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
