'use client';

import { GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { restartTourAction } from '../actions';

/**
 * Skipping the walkthrough must not be a one-way door.
 *
 * The tour dismisses itself for good on "skip" — that is the point of a
 * tutorial that respects a merchant in a hurry — so the way back has to exist
 * somewhere obvious and deliberate. Here, not as a nag on the dashboard.
 */
export function ReplayTourCard() {
  const t = useTranslations('Tour');
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-5">
      <h2 className="inline-flex items-center gap-2 text-base font-semibold">
        <GraduationCap className="size-4" aria-hidden />
        {t('replayTitle')}
      </h2>
      <p className="text-sm leading-relaxed text-[var(--muted)]">{t('replayHint')}</p>
      <button
        type="button"
        disabled={busy || done}
        onClick={() => start(async () => setDone((await restartTourAction()).ok))}
        className="mt-1 self-start rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-60"
      >
        {t('replay')}
      </button>
      {done ? (
        <p role="status" className="text-xs text-[var(--success)]">
          {t('replayDone')}
        </p>
      ) : null}
    </section>
  );
}
