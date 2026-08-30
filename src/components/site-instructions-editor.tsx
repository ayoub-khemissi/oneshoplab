'use client';

import { Card, Spinner } from '@heroui/react';
import { Check, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '@/entities/ai-model';
import { updateProjectInstructionsAction } from '@/features/manage-project';

interface SiteInstructionsEditorProps {
  projectId: string;
  initialValue: string;
}

/**
 * Site-wide AI instructions panel on the per-site dashboard. The value is
 * combined at generation time with the per-product instructions in the API
 * route, so anything typed here applies to every product on the site (brand
 * voice, recurring constraints, audience). Saved manually via a server action;
 * the per-product field auto-saves on every generation, this one doesn't.
 */
export function SiteInstructionsEditor({ projectId, initialValue }: SiteInstructionsEditorProps) {
  const t = useTranslations('SiteInstructions');
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = value !== savedValue;

  function handleSubmit(formData: FormData) {
    const next = value;
    startTransition(async () => {
      await updateProjectInstructionsAction(formData);
      setSavedValue(next);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    });
  }

  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            {t('label')}
          </span>
          <p className="text-xs text-[var(--muted)] max-w-2xl leading-relaxed">{t('hint')}</p>
        </div>
        <Sparkles className="size-4 text-[var(--accent)] shrink-0" aria-hidden />
      </div>
      <form action={handleSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <textarea
          name="customInstructions"
          rows={3}
          maxLength={MAX_CUSTOM_INSTRUCTIONS_CHARS}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS))}
          placeholder={t('placeholder')}
          className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition resize-y min-h-[80px]"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-mono text-[var(--muted)] tabular-nums">
            {value.length}/{MAX_CUSTOM_INSTRUCTIONS_CHARS}
          </span>
          <div className="flex items-center gap-3">
            {savedAt ? (
              <span className="text-xs text-[var(--success)] font-medium inline-flex items-center gap-1.5">
                <Check className="size-3.5" /> {t('saved')}
              </span>
            ) : null}
            <button
              type="submit"
              disabled={!dirty || isPending}
              className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {isPending ? <Spinner size="sm" /> : t('saveButton')}
            </button>
          </div>
        </div>
      </form>
    </Card>
  );
}
