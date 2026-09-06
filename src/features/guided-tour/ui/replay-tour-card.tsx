'use client';

import { GraduationCap, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { restartTourAction } from '../actions';
import { TOUR_CHAPTERS, stepsFor, type TourChapterId } from '../model/steps';

/**
 * Skipping the walkthrough must not be a one-way door — and coming back must
 * not cost a ride through all thirteen steps.
 *
 * So the way back is a list of chapters. Picking one replays exactly that
 * part and stops at its end; "the whole tour" runs the lot. Both live here,
 * as a deliberate click, rather than as a banner nagging on the dashboard.
 */
export function ReplayTourCard() {
  const t = useTranslations('Tour');
  const [started, setStarted] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const replay = (chapter?: TourChapterId) =>
    start(async () => {
      const res = await restartTourAction(chapter);
      if (res.ok) setStarted(chapter ?? 'all');
    });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-5">
      <div className="flex flex-col gap-1">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold">
          <GraduationCap className="size-4" aria-hidden />
          {t('replayTitle')}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('replayHint')}</p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {TOUR_CHAPTERS.map((chapter) => (
          <li key={chapter}>
            <button
              type="button"
              disabled={busy}
              onClick={() => replay(chapter)}
              data-testid={`replay-${chapter}`}
              className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
                started === chapter
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] hover:border-[var(--accent)]'
              }`}
            >
              <span className="min-w-0 truncate font-medium">{t(`chapters.${chapter}`)}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                {t('chapterSteps', { count: stepsFor(chapter).length })}
                <Play className="size-3" aria-hidden />
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={busy}
        onClick={() => replay()}
        data-testid="replay-all"
        className="self-start rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-60"
      >
        {t('replay')}
      </button>

      {started ? (
        <p role="status" className="text-xs text-[var(--success)]">
          {t('replayDone')}
        </p>
      ) : null}
    </section>
  );
}
