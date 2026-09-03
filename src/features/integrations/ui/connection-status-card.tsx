'use client';

import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SyncNow } from './sync-now';
import { useEffect, useState } from 'react';
import { getConnectionStatusAction } from '../api/actions';
import type { ConnectionStatus } from '../model/types';

const POLL_MS = 10_000;
const TICK_MS = 1_000;

export function ConnectionStatusCard({
  projectId,
  initial,
  syncRequestedAtIso
}: {
  projectId: string;
  initial: ConnectionStatus;
  /** Last manual "sync now" on this store — holds the button for a minute. */
  syncRequestedAtIso?: string | null;
}) {
  const t = useTranslations('Integrations');
  const [status, setStatus] = useState(initial);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const fd = new FormData();
    fd.set('projectId', projectId);
    const poll = async () => {
      try {
        const next = await getConnectionStatusAction(fd);
        if (!cancelled) setStatus(next);
      } catch {
        /* transient — the next tick retries */
      }
    };
    const pollId = setInterval(poll, POLL_MS);
    const tickId = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, [projectId]);

  const connected = status.lastUsedAtIso !== null;
  const ago = connected ? relativeAgo(now - new Date(status.lastUsedAtIso!).getTime(), t) : '';

  return (
    <div
      data-testid="connection-status"
      data-state={connected ? 'connected' : 'waiting'}
      className={`rounded-md border p-4 flex flex-col gap-3 ${
        connected
          ? 'border-[var(--success)]/40 bg-[var(--success)]/5'
          : 'border-[var(--border)] bg-[var(--default)]/40'
      }`}
    >
      <div className="flex items-start gap-3">
        {connected ? (
          <CheckCircle2 className="size-5 text-[var(--success)] shrink-0 mt-0.5" aria-hidden />
        ) : (
          <CircleDashed
            className="size-5 text-[var(--muted)] shrink-0 mt-0.5 animate-spin [animation-duration:3s]"
            aria-hidden
          />
        )}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-sm font-semibold">
            {connected ? t('connected', { ago, count: status.productCount }) : t('waiting')}
          </span>
          {!connected ? (
            <span className="text-xs text-[var(--muted)] leading-relaxed">{t('waitingHint')}</span>
          ) : (
            <SyncNow
              projectId={projectId}
              lastSeenAtIso={status.lastUsedAtIso}
              lastRequestedAtIso={syncRequestedAtIso ?? null}
            />
          )}
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-[var(--accent)] hover:underline select-none">
          {t('troubleTitle')}
        </summary>
        <ol className="mt-2 flex flex-col gap-1.5 list-decimal pl-5 text-[var(--muted)] leading-relaxed">
          <li>{t('fix1')}</li>
          <li>{t('fix2')}</li>
          <li>{t('fix3')}</li>
        </ol>
      </details>
    </div>
  );
}

function relativeAgo(
  elapsedMs: number,
  t: (key: 'ago.seconds' | 'ago.minutes' | 'ago.hours' | 'ago.days', v: { n: number }) => string
): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  if (s < 60) return t('ago.seconds', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('ago.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('ago.hours', { n: h });
  return t('ago.days', { n: Math.floor(h / 24) });
}
