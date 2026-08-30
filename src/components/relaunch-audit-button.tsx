'use client';

import { Spinner } from '@heroui/react';
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { relaunchProjectAuditAction } from '@/features/run-audit';

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

  // `now` must not be read from Date.now() during render: SSR and the
  // client first render would disagree → React #418. Start at 0 and
  // only consider the cooldown "live" once mounted, so SSR + the
  // first client render both produce the (deterministic) unlocked
  // form. The server action re-checks the rate limit, so the ~1-frame
  // window before the cooldown paints is safe.
  const [now, setNow] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Holds the FormData that will be posted on confirm. We capture it
  // synchronously inside the form's `action` so React doesn't reuse
  // the same FormData object after the user dismisses the dialog.
  const pendingFormDataRef = useRef<FormData | null>(null);

  useEffect(() => {
    setMounted(true);
    if (!nextSlotAtIso) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [nextSlotAtIso]);

  const remainingMs = mounted && nextSlotAtIso ? Math.max(0, readyAt - now) : 0;
  const locked = remainingMs > 0;

  function requestConfirm(formData: FormData) {
    // Server form action fires on submit; we intercept to ask for
    // confirmation first and stash the FormData so the eventual
    // confirm-click can replay it. Since the relaunch button always
    // renders on a page that already has at least one prior audit
    // (you reach this URL through the dashboard listing), every
    // relaunch is technically a re-run — hence we always prompt.
    pendingFormDataRef.current = formData;
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    const formData = pendingFormDataRef.current;
    if (!formData) return;
    pendingFormDataRef.current = null;
    setConfirmOpen(false);
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
    <>
      <form action={requestConfirm}>
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
      <ConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) pendingFormDataRef.current = null;
        }}
        title={t('confirmRelaunchTitle')}
        description={t('confirmRelaunchBody', {
          used: auditsUsed,
          limit: auditsLimit
        })}
        confirmLabel={t('relaunch')}
        cancelLabel={t('cancelLabel')}
        destructive={false}
        isPending={isPending}
        onConfirm={handleConfirm}
      />
    </>
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
