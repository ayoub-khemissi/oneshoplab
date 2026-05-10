'use client';

import { Spinner } from '@heroui/react';
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { relaunchProjectAuditAction } from '@/lib/auth-actions';

interface RelaunchAuditButtonProps {
  projectId: string;
  /** Number of pending/running/completed audits the user already launched
   *  in the rolling 24h window across all their projects. */
  auditsUsed: number;
  /** Hard cap on audits per 24h, equals the plan's site quota. */
  auditsLimit: number;
  /** ISO timestamp at which the next quota slot opens up — null while
   *  the user still has slots available. */
  nextSlotAtIso: string | null;
}

/**
 * "Relaunch analysis" button on the per-site dashboard. Gated by a
 * user-wide rate limit (auditsLimit per AUDIT_RATE_LIMIT_WINDOW_MS),
 * not a per-site cooldown — locking by site let merchants game it
 * by deleting and re-creating projects.
 *
 * When the merchant still has slots, shows "Relaunch · 1/3 today" or
 * similar so they understand the pacing. When they've burned through
 * the quota, the button disables and ticks down to the next slot.
 *
 * Failed / timed_out audits don't count toward the quota (handled by
 * the server side query) so a bad first run never locks the user out.
 */
export function RelaunchAuditButton({
  projectId,
  auditsUsed,
  auditsLimit,
  nextSlotAtIso
}: RelaunchAuditButtonProps) {
  const t = useTranslations('Relaunch');
  const readyAt = nextSlotAtIso ? new Date(nextSlotAtIso).getTime() : 0;

  const [now, setNow] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!nextSlotAtIso) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [nextSlotAtIso]);

  const remainingMs = nextSlotAtIso ? Math.max(0, readyAt - now) : 0;
  const locked = remainingMs > 0;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await relaunchProjectAuditAction(formData);
    });
  }

  if (locked) {
    return (
      <button
        type="button"
        disabled
        title={t('cooldownTooltip', { time: formatRemaining(remainingMs, t) })}
        aria-label={t('relaunch')}
        className="inline-flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--muted)] text-sm font-medium opacity-60 cursor-not-allowed"
      >
        <RotateCw className="size-3.5" aria-hidden />
        <span className="font-mono tabular-nums">{formatRemaining(remainingMs, t)}</span>
      </button>
    );
  }

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="projectId" value={projectId} />
      <button
        type="submit"
        disabled={isPending}
        title={t('quotaTooltip', { used: auditsUsed, limit: auditsLimit })}
        aria-label={t('relaunch')}
        className="inline-flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <>
            <Spinner size="sm" />
            <span className="hidden md:inline">{t('relaunching')}</span>
          </>
        ) : (
          <>
            <RotateCw className="size-3.5" aria-hidden />
            <span className="hidden md:inline">{t('relaunch')}</span>
            <span className="text-xs opacity-70 font-mono tabular-nums">
              {auditsUsed}/{auditsLimit}
            </span>
          </>
        )}
      </button>
    </form>
  );
}

function formatRemaining(
  ms: number,
  t: (key: string, values: Record<string, string | number>) => string
): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return t('inHoursMinutes', { h, m: String(m).padStart(2, '0') });
  if (m > 0) return t('inMinutesSeconds', { m, s: String(s).padStart(2, '0') });
  return t('inSeconds', { s });
}
