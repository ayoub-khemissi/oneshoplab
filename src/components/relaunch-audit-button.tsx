'use client';

import { Spinner } from '@heroui/react';
import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { auditCooldownMsForPlan } from '@/lib/ai/models';
import { relaunchProjectAuditAction } from '@/lib/auth-actions';

interface RelaunchAuditButtonProps {
  projectId: string;
  /** ISO string passed down from the server component (Date isn't serialisable). */
  lastAuditAtIso: string | null;
  plan: 'free' | 'starter' | 'pro' | 'scale';
}

/**
 * "Relaunch analysis" button on the per-site dashboard. Disabled with a live
 * countdown until the per-plan cooldown elapses since the most recent audit.
 * Re-renders on a 1s tick so the user sees the timer count down live without
 * needing to refresh the page.
 */
export function RelaunchAuditButton({
  projectId,
  lastAuditAtIso,
  plan
}: RelaunchAuditButtonProps) {
  const t = useTranslations('Relaunch');
  const cooldownMs = auditCooldownMsForPlan(plan);
  const lastAuditAt = lastAuditAtIso ? new Date(lastAuditAtIso) : null;
  const readyAt = lastAuditAt ? lastAuditAt.getTime() + cooldownMs : 0;

  const [now, setNow] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, readyAt - now);
  const ready = remainingMs <= 0;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await relaunchProjectAuditAction(formData);
    });
  }

  if (!ready) {
    return (
      <button
        type="button"
        disabled
        title={t('cooldownTooltip', { time: formatRemaining(remainingMs, t) })}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--muted)] text-sm font-medium opacity-60 cursor-not-allowed"
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <>
            <Spinner size="sm" />
            <span>{t('relaunching')}</span>
          </>
        ) : (
          <>
            <RotateCw className="size-3.5" aria-hidden />
            <span>{t('relaunch')}</span>
          </>
        )}
      </button>
    </form>
  );
}

/**
 * Format a remaining-ms value as a compact "5h 23m" / "12m 04s" / "47s"
 * string. Hours bucket dominates above 1h, minutes between 1m-1h, seconds
 * under 1m. Keeps the button stable-width by always showing two units.
 */
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
