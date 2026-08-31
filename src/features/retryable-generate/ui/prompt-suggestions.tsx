'use client';

import { Spinner } from '@heroui/react';
import { Coins, Lightbulb } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '@/entities/ai-model';
import { suggestPromptsAction } from '../actions';
import { useGenerateContext } from './context';

export interface PromptSuggestionsProps {
  productId: string;
  /** Credits the first round costs — shown on the button like every other
   *  paying action, and the exact amount debited. */
  cost: number;
  creditsBalance: number;
}

/**
 * A merchant who doesn't know what to write in "custom instructions" writes
 * nothing. This offers ready-made angles for their actual product — click one,
 * it lands in the box, and they edit it from there. Suggestions are cached per
 * product and field, so re-opening the list later costs nothing.
 */
export function PromptSuggestions({ productId, cost, creditsBalance }: PromptSuggestionsProps) {
  const t = useTranslations('Product');
  const { setCustomInstructions } = useGenerateContext();
  const [items, setItems] = useState<Array<{ tone: string; prompt: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const affordable = creditsBalance >= cost;

  function ask() {
    setError(null);
    startTransition(async () => {
      const res = await suggestPromptsAction(productId, 'description');
      if (res.ok) setItems(res.suggestions);
      else
        setError(
          res.error === 'insufficient_credits'
            ? t('insufficientCredits')
            : t('suggestPromptsFailed')
        );
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {items === null ? (
        <button
          type="button"
          onClick={ask}
          disabled={busy || !affordable}
          data-testid="suggest-prompts"
          title={!affordable ? t('insufficientCredits') : undefined}
          className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            affordable
              ? 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60'
              : 'cursor-not-allowed border-[var(--border)] text-[var(--muted)] opacity-60'
          }`}
        >
          {busy ? (
            <>
              <Spinner size="sm" />
              <span>{t('suggestPromptsBusy')}</span>
            </>
          ) : (
            <>
              <Lightbulb className="size-3.5" aria-hidden />
              <span>{t('suggestPrompts')}</span>
              <span className="inline-flex items-center gap-1 font-mono text-xs text-[var(--muted)]">
                · <Coins className="size-3" aria-hidden /> {cost}
              </span>
            </>
          )}
        </button>
      ) : items.length === 0 ? (
        <p className="text-xs text-[var(--muted)] italic">{t('suggestPromptsEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--muted)]">{t('suggestPromptsHint')}</span>
          <ul className="flex flex-col gap-1.5">
            {items.map((s, i) => (
              <li key={`${s.tone}-${i}`}>
                <button
                  type="button"
                  onClick={() =>
                    setCustomInstructions(s.prompt.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS))
                  }
                  className="flex w-full flex-col gap-0.5 rounded-md border border-[var(--border)] px-3 py-2 text-left text-sm hover:border-[var(--accent)] hover:bg-[var(--accent)]/5"
                >
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--accent)]">
                    {s.tone}
                  </span>
                  <span className="text-[var(--muted)]">{s.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
