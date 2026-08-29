'use client';

import { Spinner } from '@heroui/react';
import { Coins, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useFieldSwapGroup, useFieldView } from '@/components/field-swap';
import type { GenField } from '@/components/generate-button';
import { CancelButton } from '@/components/retryable-generate/cancel-button';
import { useGenerateContext } from '@/components/retryable-generate/context';
import { FIELDS, isInflight, MAX_ATTEMPTS } from '@/components/retryable-generate/state';
import { useCountdownTo, useElapsedSinceMs } from '@/components/retryable-generate/use-timers';
import { trackEvent } from '@/lib/analytics-event';

interface ButtonProps {
  field: GenField;
  /** True when this field already has at least one prior AI generation. The
   *  button copy switches from "Generate" to "Regenerate" so the user
   *  understands they're overwriting / adding to existing output. */
  hasHistory?: boolean;
  /** Optional gate on top of the credit-based affordance check (e.g. "no
   *  source images → can't regenerate images"). Defaults to true. */
  available?: boolean;
}

export function RetryableGenerateButton({
  field,
  hasHistory = false,
  available = true
}: ButtonProps) {
  const t = useTranslations('Product');
  const { states, submit, cancel, costFor, canAfford, productArchived } = useGenerateContext();
  // Per-field view scope (FieldRow) and panel-level view scope
  // (FieldSwapGroup) — both optional. We use them to auto-flip the
  // view to "AI" when a generation is launched, so the merchant
  // lands directly on the freshly-running output instead of
  // staring at the source side while their click does nothing
  // visible.
  const fieldView = useFieldView();
  const groupView = useFieldSwapGroup();
  const state = states[field];
  const allState = states.all;
  const cost = costFor(field);
  const enabled = available && canAfford(field) && !productArchived;

  const launchSubmit = useCallback(() => {
    // Activation metric — a user-initiated AI generation launch.
    trackEvent('generate', { field });
    if (field === 'all') {
      // Flip every section to the AI view in a single shot via the
      // group context — bumps syncCount, every FieldSwap / per-field
      // provider rehydrates from the new group view.
      groupView?.setView('ai');
    } else {
      // Per-section: flip just this section. The FieldViewProvider
      // wrapping this row carries the state, no leak to siblings.
      fieldView?.setView('ai');
    }
    submit(field);
  }, [field, fieldView, groupView, submit]);
  // Confirmation dialog only on the "Generate / Regenerate everything"
  // button. Per-field actions go through directly — they're cheap
  // single-shot calls and their cost is already on the button label.
  // The all-button hits 4-5 generations at once + can overwrite
  // existing outputs on regenerate, hence the explicit prompt.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isAll = field === 'all';
  // This specific field is in flight (clicking "Title" while title runs
  // shows the spinner here, not on Description).
  const isThisOne = isInflight(state);
  // Global lock: when the "Generate all" button is running, every
  // single-field button locks because that's exactly what 'all' is
  // doing server-side. For the 'all' button itself, lock when any
  // *other* field is running too — running a chat + image lane in
  // parallel is fine, but kicking off another "all" on top is not.
  const allInflight = isInflight(allState);
  const otherSingleInflight = isAll
    ? FIELDS.some((f) => f !== 'all' && isInflight(states[f]))
    : false;
  const blockedByGlobal = (!isAll && allInflight) || (isAll && otherSingleInflight);

  const elapsed = useElapsedSinceMs(state.kind === 'pending' ? state.startedAt : null);
  const waitSeconds = useCountdownTo(state.kind === 'waiting' ? state.resumeAt : null);

  const baseClasses =
    'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed';
  const enabledClasses = isAll
    ? 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-70'
    : 'border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60';
  const unaffordableClasses =
    'border border-[var(--border)] text-[var(--muted)] opacity-60 cursor-not-allowed';
  const classes = !enabled ? unaffordableClasses : enabledClasses;

  if (isThisOne && state.kind === 'pending') {
    // Hide the "X/3" badge on attempt 1 — surfacing "1/3" before anything
    // has even failed reads as a retry counter to the user. Show it only
    // when we're actually retrying.
    const showAttemptBadge = state.attempt > 1;
    return (
      <div className="inline-flex items-center gap-2">
        <button type="button" disabled className={`${baseClasses} ${classes}`}>
          <Spinner size="sm" />
          <span>
            {t('generating', { seconds: elapsed })}
            {showAttemptBadge ? (
              <span className="opacity-70 font-mono ml-1">
                · {state.attempt}/{MAX_ATTEMPTS}
              </span>
            ) : null}
          </span>
        </button>
        <CancelButton onCancel={() => cancel(field)} label={t('cancelGeneration')} />
      </div>
    );
  }

  if (isThisOne && state.kind === 'waiting') {
    return (
      <div className="inline-flex items-center gap-2">
        <button type="button" disabled className={`${baseClasses} ${classes}`}>
          <Spinner size="sm" />
          <span>
            {t('retryingIn', { seconds: waitSeconds })}
            <span className="opacity-70 font-mono ml-1">
              · {state.nextAttempt}/{MAX_ATTEMPTS}
            </span>
          </span>
        </button>
        <CancelButton onCancel={() => cancel(field)} label={t('cancelGeneration')} />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (isAll ? setConfirmOpen(true) : launchSubmit())}
        disabled={!enabled || blockedByGlobal}
        className={`${baseClasses} ${classes}`}
        title={!enabled ? t('insufficientCredits') : undefined}
      >
        {isAll ? (
          <>
            <Sparkles className="size-3.5" />
            <span>{hasHistory ? t('regenerateAll') : t('generateAll')}</span>
          </>
        ) : (
          <span>{hasHistory ? t('regenerateField') : t('generateField')}</span>
        )}
        <span
          className={`text-xs font-mono inline-flex items-center gap-1 ${isAll ? 'opacity-80' : 'text-[var(--muted)]'}`}
        >
          · <Coins className="size-3" aria-hidden /> {cost}
        </span>
      </button>
      {isAll ? (
        <ConfirmDialog
          isOpen={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={hasHistory ? t('confirmRegenerateAllTitle') : t('confirmGenerateAllTitle')}
          description={
            hasHistory
              ? t('confirmRegenerateAllBody', { cost })
              : t('confirmGenerateAllBody', { cost })
          }
          confirmLabel={hasHistory ? t('regenerateAll') : t('generateAll')}
          cancelLabel={t('cancelGeneration')}
          destructive={hasHistory}
          onConfirm={launchSubmit}
        />
      ) : null}
    </>
  );
}
