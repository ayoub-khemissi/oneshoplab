'use client';

import { useTranslations } from 'next-intl';
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '@/lib/ai/models';
import { useGenerateContext } from '@/components/retryable-generate/context';

/**
 * Custom-instructions textarea controlled by the provider so its current
 * value is included with every generation request — no need for a `<form>`
 * around the buttons anymore.
 */
interface CustomInstructionsFieldProps {
  /** When the project carries site-wide instructions, surface a notice so
   *  the merchant knows extra guidance is being added on top of theirs. */
  hasSiteInstructions?: boolean;
}

export function CustomInstructionsField({
  hasSiteInstructions = false
}: CustomInstructionsFieldProps) {
  const t = useTranslations('Product');
  const { customInstructions, setCustomInstructions } = useGenerateContext();
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="custom-instructions"
        className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]"
      >
        {t('customInstructionsLabel')}
      </label>
      <textarea
        id="custom-instructions"
        name="customInstructions"
        rows={3}
        maxLength={MAX_CUSTOM_INSTRUCTIONS_CHARS}
        value={customInstructions}
        onChange={(e) =>
          setCustomInstructions(e.target.value.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS))
        }
        placeholder={t('customInstructionsPlaceholder')}
        className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition resize-y min-h-[80px]"
      />
      <div className="flex items-baseline justify-between gap-3 text-xs text-[var(--muted)]">
        <p>
          {t('customInstructionsHint')}
          {hasSiteInstructions ? ` ${t('customInstructionsSiteHint')}` : ''}
        </p>
        <span className="font-mono shrink-0 tabular-nums">
          {customInstructions.length}/{MAX_CUSTOM_INSTRUCTIONS_CHARS}
        </span>
      </div>
    </div>
  );
}
