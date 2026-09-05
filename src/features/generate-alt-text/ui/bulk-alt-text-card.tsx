'use client';

import { AlertTriangle, Check, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { generateMissingAltForProductAction, planMissingAltTextAction } from '../api/actions';
import { errorKeyFor } from '../lib/error-key';
import type { AltBatchProgress, AltTextErrorCode } from '../model/types';

/**
 * "Générer les textes alternatifs manquants (N)" on the site's products tab —
 * the batch answer to the audit's `missing_alt_text` issue.
 *
 * The run is driven product by product from here rather than in one server
 * call: the progress bar then reports work that actually happened, and no
 * single request holds a connection for the minute a 25-photo batch takes.
 * Every call is authorised and priced again server-side.
 */
export function BulkAltTextCard({
  projectId,
  missingCount,
  variant = 'card'
}: {
  projectId: string;
  /** Photos the latest audit reported without an alt text. */
  missingCount: number;
  /** `inline` drops the heading and the frame: the products tab shows this as
   *  one button in a toolbar, because a full card above the list pushed the
   *  products themselves off a phone screen. */
  variant?: 'card' | 'inline';
}) {
  const t = useTranslations('AltText');
  const router = useRouter();
  const [progress, setProgress] = useState<AltBatchProgress | null>(null);
  const [summary, setSummary] = useState<(AltBatchProgress & { remaining: number }) | null>(null);
  const [error, setError] = useState<AltTextErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  if (missingCount <= 0 && !summary) return null;

  function run() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const plan = await planMissingAltTextAction(projectId);
      if (!plan.ok) {
        setError(plan.error);
        return;
      }
      const state: AltBatchProgress = {
        done: 0,
        total: plan.products.length,
        generated: 0,
        changes: 0,
        failed: 0
      };
      setProgress({ ...state });
      for (const product of plan.products) {
        const res = await generateMissingAltForProductAction(product.productId);
        state.done += 1;
        if (res.ok) {
          state.generated += res.generated;
          state.changes += res.changeQueued ? 1 : 0;
        } else {
          state.failed += 1;
          // Nothing left to pay with: stop instead of burning through the
          // remaining products just to collect the same refusal each time.
          if (res.error === 'insufficient_credits') {
            setError('insufficient_credits');
            break;
          }
        }
        setProgress({ ...state });
      }
      setProgress(null);
      setSummary({ ...state, remaining: plan.remaining });
      router.refresh();
    });
  }

  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const inline = variant === 'inline';

  return (
    <section
      data-testid="bulk-alt-text"
      data-variant={variant}
      className={
        inline
          ? 'flex flex-col gap-2'
          : 'flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4'
      }
    >
      {inline ? null : (
        <>
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">{t('intro')}</p>
        </>
      )}

      {progress ? (
        <div className="flex flex-col gap-1.5" role="status" data-testid="bulk-alt-progress">
          <span className="text-sm">
            {t('progress', { done: progress.done, total: progress.total })}
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--default)]">
            <div
              className="h-full bg-[var(--accent)] transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={run}
          disabled={pending || missingCount <= 0}
          data-testid="bulk-alt-run"
          className="inline-flex w-fit items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          <Sparkles className="size-3.5" aria-hidden />
          {t('bulkAction', { count: missingCount })}
        </button>
      )}

      {summary ? (
        <div className="flex flex-col gap-0.5 text-sm" role="status" data-testid="bulk-alt-summary">
          <span className="inline-flex items-center gap-1.5 text-[var(--success)]">
            <Check className="size-4" aria-hidden />
            {t('summary', { generated: summary.generated, changes: summary.changes })}
          </span>
          {summary.failed > 0 ? (
            <span className="text-[var(--muted)]">
              {t('summaryFailed', { count: summary.failed })}
            </span>
          ) : null}
          {summary.remaining > 0 ? (
            <span className="text-[var(--muted)]">
              {t('summaryRemaining', { count: summary.remaining })}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-[var(--danger)]" role="alert">
          <AlertTriangle className="size-4" aria-hidden /> {t(errorKeyFor(error))}
        </p>
      ) : null}
    </section>
  );
}
