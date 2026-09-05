'use client';

import { useTranslations } from 'next-intl';
import { useRef, useTransition } from 'react';
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '@/entities/ai-model';
import { InfoHint } from '@/shared/ui';
import { saveProductInstructionsAction } from '../actions';
import { useGenerateContext } from './context';
import { PromptSuggestions } from './prompt-suggestions';

/**
 * Custom-instructions textarea controlled by the provider so its current
 * value is included with every generation request — no need for a `<form>`
 * around the buttons anymore.
 */
interface CustomInstructionsFieldProps {
  /** When the project carries site-wide instructions, surface a notice so
   *  the merchant knows extra guidance is being added on top of theirs. */
  hasSiteInstructions?: boolean;
  /** Offers ready-made angles under the box. Omitted (with its cost) the
   *  suggestions simply aren't proposed. */
  suggestions?: {
    productId: string;
    cost: number;
    creditsBalance: number;
    /** Angles already generated for this product, loaded server-side. */
    initial?: Array<{ tone: string; prompt: string }>;
    /** A round already running when the page loaded. */
    startedAtMs?: number | null;
  };
  /** Product whose row stores the text. Without it the field stays in memory
   *  (the bulk panel reuses this component for a whole store). */
  productId?: string;
  /** What the product row already held, to know whether a blur changed it. */
  savedValue?: string;
}

export function CustomInstructionsField({
  hasSiteInstructions = false,
  suggestions,
  productId,
  savedValue = ''
}: CustomInstructionsFieldProps) {
  const t = useTranslations('Product');
  const { customInstructions, setCustomInstructions } = useGenerateContext();
  const saved = useRef(savedValue);
  const [, startSaving] = useTransition();

  function persist(value?: string) {
    if (!productId) return;
    // The picked angle is passed in: React has not re-rendered with the new
    // state yet when the click handler fires.
    const next = (value ?? customInstructions).trim();
    if (next === saved.current.trim()) return;
    saved.current = next;
    startSaving(async () => {
      await saveProductInstructionsAction(productId, next);
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="inline-flex items-center gap-1.5">
        <label
          htmlFor="custom-instructions"
          className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]"
        >
          {t('customInstructionsLabel')}
        </label>
        <InfoHint topic="customInstructions" label={t('customInstructionsLabel')} />
      </span>
      <textarea
        id="custom-instructions"
        name="customInstructions"
        rows={3}
        maxLength={MAX_CUSTOM_INSTRUCTIONS_CHARS}
        value={customInstructions}
        onChange={(e) =>
          setCustomInstructions(e.target.value.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS))
        }
        onBlur={() => persist()}
        placeholder={t('customInstructionsPlaceholder')}
        className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition resize-y min-h-[80px]"
      />
      {suggestions ? (
        <PromptSuggestions
          productId={suggestions.productId}
          cost={suggestions.cost}
          creditsBalance={suggestions.creditsBalance}
          initial={suggestions.initial}
          startedAtMs={suggestions.startedAtMs}
          onPicked={(value) => persist(value)}
        />
      ) : null}
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
