'use client';

import { Spinner } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { requestSyncNowAction } from '../api/actions';
import { cooldownRemainingMs, msUntilNextCheck } from '../lib/sync-schedule';

/**
 * When the store next checks in, and a way not to wait for it.
 *
 * A merchant who has just approved something wants to see it land, and "within
 * five minutes" is only reassuring when you can see the five minutes running
 * out. The button asks the store to come now — held to one a minute, because
 * the ask reaches a store that is already checking on its own.
 */
export function SyncNow({
  projectId,
  lastSeenAtIso,
  lastRequestedAtIso
}: {
  projectId: string;
  /** Last call from the store — the countdown is anchored on it. */
  lastSeenAtIso: string | null;
  lastRequestedAtIso: string | null;
}) {
  const t = useTranslations('Integrations');
  const [requestedAt, setRequestedAt] = useState<string | null>(lastRequestedAtIso);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // One tick a second: the countdown is the point, and nothing else here
  // depends on it.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const untilNext = msUntilNextCheck(lastSeenAtIso, now);
  const cooldown = cooldownRemainingMs(requestedAt, now);
  const seconds = Math.ceil(cooldown / 1000);

  function ask() {
    setError(null);
    startTransition(async () => {
      const res = await requestSyncNowAction(projectId);
      if (res.ok) setRequestedAt(res.requestedAtIso);
      else if (res.error === 'cooldown') setRequestedAt(new Date().toISOString());
      else setError(t('errorGeneric'));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="sync-now">
      {untilNext !== null ? (
        <span className="text-xs text-[var(--muted)]" data-testid="next-check">
          {t('nextCheck', { time: formatCountdown(untilNext) })}
        </span>
      ) : null}
      <button
        type="button"
        onClick={ask}
        disabled={busy || cooldown > 0}
        data-testid="sync-now-button"
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
      >
        {busy ? <Spinner size="sm" /> : <RefreshCw className="size-3.5" aria-hidden />}
        {cooldown > 0 ? t('syncNowCooldown', { seconds }) : t('syncNowAsk')}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** m:ss while there are minutes left, plain seconds under a minute. */
function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}
