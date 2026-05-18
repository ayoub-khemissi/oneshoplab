'use client';

import { Spinner } from '@heroui/react';
import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

export type GenField = 'title' | 'description' | 'tags' | 'images' | 'all';

interface GenerateButtonProps {
  field: GenField;
  cost: number;
  /** False when the user can't afford this generation. The button is also
   *  disabled (greyed out) while another submission is in flight to avoid
   *  duplicate requests. */
  enabled: boolean;
}

/**
 * Submit button for the per-field generation form. Reads the form's pending
 * state via `useFormStatus` so:
 *   - The clicked button shows a spinner + a live elapsed timer
 *   - All sibling buttons go disabled (no parallel submits, no double-click)
 *
 * Lives in its own client module because the page is a server component
 * (data fetching) and `useFormStatus` only works in client trees nested
 * inside the `<form>`.
 */
export function GenerateButton({ field, cost, enabled }: GenerateButtonProps) {
  const t = useTranslations('Product');
  const { pending, data } = useFormStatus();
  const isThisOne = pending && data?.get('field') === field;
  const elapsedSec = useElapsedSeconds(isThisOne);

  const isAll = field === 'all';
  const disabled = !enabled || pending;

  const baseClasses =
    'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed';
  const enabledClasses = isAll
    ? 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-70'
    : 'border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60';
  const unaffordableClasses =
    'border border-[var(--border)] text-[var(--muted)] opacity-60 cursor-not-allowed';

  const classes = !enabled ? unaffordableClasses : enabledClasses;

  return (
    <button
      type="submit"
      name="field"
      value={field}
      disabled={disabled}
      className={`${baseClasses} ${classes}`}
      title={!enabled ? t('insufficientCredits') : undefined}
    >
      {isThisOne ? (
        <>
          <Spinner size="sm" />
          <span>{t('generating', { seconds: elapsedSec })}</span>
        </>
      ) : (
        <>
          <span>{isAll ? t('generateAll') : t('generateField')}</span>
          <span className={`text-xs font-mono inline-flex items-center gap-1 ${isAll ? 'opacity-80' : 'text-[var(--muted)]'}`}>
            · <Coins className="size-3" aria-hidden /> {cost}
          </span>
        </>
      )}
    </button>
  );
}

/**
 * Live-counts seconds since the active flag flipped to true. Resets to 0
 * each time the flag toggles. Updated on a 250ms interval — fast enough to
 * feel responsive but not so often that React re-renders pile up.
 */
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [active]);
  return seconds;
}
