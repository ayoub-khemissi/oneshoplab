'use client';

import { Modal, Spinner } from '@heroui/react';
import { Coins, Lightbulb, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '@/entities/ai-model';
import { ElapsedTimer, ModalCloseButton } from '@/shared/ui';
import { suggestPromptsAction } from '../actions';
import { useGenerateContext } from './context';

export interface PromptSuggestionsProps {
  productId: string;
  /** Credits the first round costs — shown on the button like every other
   *  paying action, and the exact amount debited. */
  cost: number;
  creditsBalance: number;
  /** Called with the angle that just landed in the field, so the page can
   *  persist it without waiting for the next render. */
  onPicked?: (value: string) => void;
  /** Angles already generated for this product, loaded server-side. They were
   *  paid for and cached; leaving the page used to hide them for good. */
  initial?: Array<{ tone: string; prompt: string }>;
  /** A round already running when the page loaded — read from its job row, so
   *  a refresh mid-generation resumes it instead of showing a button that has
   *  forgotten it was pressed. */
  startedAtMs?: number | null;
}

/**
 * A merchant who doesn't know what to write in "custom instructions" writes
 * nothing. This offers ready-made angles for their actual product — click one,
 * it lands in the box, and they edit it from there. Suggestions are cached per
 * product and field, so re-opening the list later costs nothing.
 */
export function PromptSuggestions({
  productId,
  cost,
  creditsBalance,
  onPicked,
  initial,
  startedAtMs
}: PromptSuggestionsProps) {
  const t = useTranslations('Product');
  const { setCustomInstructions } = useGenerateContext();
  const [items, setItems] = useState<Array<{ tone: string; prompt: string }> | null>(
    initial && initial.length > 0 ? initial : null
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Either this tab is generating, or another one was and the job is still
  // running: both mean "in flight", and the merchant should see the same thing.
  const inFlight = busy || startedAtMs != null;
  const affordable = creditsBalance >= cost;

  function ask(force = false) {
    setError(null);
    startTransition(async () => {
      const res = await suggestPromptsAction(productId, 'description', force);
      if (res.ok) {
        setItems(res.suggestions);
        setOpen(true);
      } else
        setError(
          res.error === 'insufficient_credits'
            ? t('insufficientCredits')
            : t('suggestPromptsFailed')
        );
    });
  }

  function pick(prompt: string) {
    const value = prompt.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS);
    setCustomInstructions(value);
    onPicked?.(value);
    setOpen(false);
  }

  const hasItems = items !== null && items.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasItems ? (
        <>
          {/* Discreet: the angles were paid for and kept, so re-opening them is
              free and should not look like a new spend. */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-testid="suggest-prompts-see"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline underline-offset-2"
          >
            <Lightbulb className="size-3.5" aria-hidden />
            {t('suggestPromptsSee', { count: items.length })}
          </button>
          <button
            type="button"
            onClick={() => ask(true)}
            disabled={inFlight || !affordable}
            title={!affordable ? t('insufficientCredits') : undefined}
            data-testid="suggest-prompts-again"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-60"
          >
            {inFlight ? <Spinner size="sm" /> : <RefreshCw className="size-3" aria-hidden />}
            {t('suggestPromptsAgain')}
            <span className="inline-flex items-center gap-0.5 font-mono">
              <Coins className="size-2.5" aria-hidden /> {cost}
            </span>
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => ask(false)}
          disabled={inFlight || !affordable}
          data-testid="suggest-prompts"
          title={!affordable ? t('insufficientCredits') : undefined}
          className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            affordable
              ? 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60'
              : 'cursor-not-allowed border-[var(--border)] text-[var(--muted)] opacity-60'
          }`}
        >
          {inFlight ? (
            <>
              <Spinner size="sm" />
              <span>{t('suggestPromptsBusy')}</span>
              {startedAtMs != null ? <ElapsedTimer startedAt={startedAtMs} /> : null}
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
      )}

      {items !== null && items.length === 0 ? (
        <p className="text-xs text-[var(--muted)] italic">{t('suggestPromptsEmpty')}</p>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <Modal isOpen={open && hasItems} onOpenChange={setOpen}>
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              {/* A modal you can only leave by picking something is a trap:
                  the merchant opened it to look. */}
              <ModalCloseButton onClose={() => setOpen(false)} label={t('suggestPromptsClose')} />
              <Modal.Header className="pr-10">
                <Modal.Heading className="text-base font-semibold">
                  {t('suggestPromptsModalTitle')}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="mb-3 text-xs text-[var(--muted)]">{t('suggestPromptsHint')}</p>
                <ul className="flex flex-col gap-1.5">
                  {(items ?? []).map((s, i) => (
                    <li key={`${s.tone}-${i}`}>
                      <button
                        type="button"
                        onClick={() => pick(s.prompt)}
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
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
