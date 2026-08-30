'use client';

import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import type { WixConnectionView } from '@/entities/shop-connection/client';
import { ConfirmDialog } from '@/shared/ui';
import { disconnectWixAction, getWixConnectionAction, requestWixPullAction } from '../api/actions';

const POLL_MS = 10_000;
const TICK_MS = 1_000;
const PLAN_LIMIT_PREFIX = 'plan_limit:';
/** The merchant removes the app from their site there (the Wix side of "Disconnect"). */
export const WIX_MANAGE_APPS_URL = 'https://manage.wix.com/dashboard';

type CardState = 'connected' | 'syncing' | 'token_invalid' | 'revoked' | 'error';

function cardState(c: WixConnectionView): CardState {
  if (c.status === 'revoked') return 'revoked';
  if (c.status === 'token_invalid') return 'token_invalid';
  if (c.pullProgress?.running || c.pullPending) return 'syncing';
  if (c.pullProgress?.error && !c.pullProgress.error.startsWith(PLAN_LIMIT_PREFIX)) return 'error';
  return 'connected';
}

/** Mirror of the Shopify card: status, last pull, progress, "Sync now", "Disconnect". */
export function WixConnectionCard({
  projectId,
  initial,
  onDisconnected
}: {
  projectId: string;
  initial: WixConnectionView;
  onDisconnected?: () => void;
}) {
  const t = useTranslations('Integrations.wix');
  const [conn, setConn] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const fd = new FormData();
    fd.set('projectId', projectId);
    const poll = async () => {
      try {
        const next = await getWixConnectionAction(fd);
        if (!cancelled && next) setConn(next);
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

  const state = cardState(conn);
  const shop = conn.shopName ?? conn.shopDomain;
  const planLimit = conn.pullProgress?.error?.startsWith(PLAN_LIMIT_PREFIX)
    ? Number(conn.pullProgress.error.slice(PLAN_LIMIT_PREFIX.length))
    : null;

  function syncNow() {
    const fd = new FormData();
    fd.set('projectId', projectId);
    setFailed(false);
    startTransition(async () => {
      const res = await requestWixPullAction(fd);
      if (res.ok) setConn((c) => ({ ...c, pullPending: true }));
      else setFailed(true);
    });
  }

  function disconnect() {
    const fd = new FormData();
    fd.set('projectId', projectId);
    setFailed(false);
    startTransition(async () => {
      const res = await disconnectWixAction(fd);
      setConfirm(false);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setConn((c) => ({ ...c, status: 'revoked', pullPending: false }));
      onDisconnected?.();
    });
  }

  const green = state === 'connected' || state === 'syncing';
  const progress = conn.pullProgress;
  const headline =
    state === 'revoked'
      ? t('revoked')
      : state === 'token_invalid'
        ? t('tokenInvalid')
        : state === 'syncing'
          ? progress?.running
            ? progress.total
              ? t('syncingProgress', { done: progress.done, total: progress.total })
              : t('syncingCount', { done: progress.done })
            : t('syncQueued')
          : state === 'error'
            ? t('syncFailed')
            : conn.lastPullAtIso
              ? t('connected', {
                  shop,
                  ago: relativeAgo(now - new Date(conn.lastPullAtIso).getTime(), t),
                  count: progress?.total ?? 0
                })
              : t('connectedNoSync', { shop });

  return (
    <div
      data-testid="wix-connection"
      data-state={state}
      className={`rounded-md border p-4 flex flex-col gap-3 ${
        green
          ? 'border-[var(--success)]/40 bg-[var(--success)]/5'
          : state === 'revoked'
            ? 'border-[var(--border)] bg-[var(--default)]/40'
            : 'border-[var(--danger)]/40 bg-[var(--danger)]/5'
      }`}
    >
      <div className="flex items-start gap-3">
        {green ? (
          state === 'syncing' ? (
            <RefreshCw
              className="size-5 text-[var(--success)] shrink-0 mt-0.5 animate-spin [animation-duration:2s]"
              aria-hidden
            />
          ) : (
            <CheckCircle2 className="size-5 text-[var(--success)] shrink-0 mt-0.5" aria-hidden />
          )
        ) : state === 'revoked' ? (
          <Unplug className="size-5 text-[var(--muted)] shrink-0 mt-0.5" aria-hidden />
        ) : (
          <AlertTriangle className="size-5 text-[var(--danger)] shrink-0 mt-0.5" aria-hidden />
        )}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-sm font-semibold">{headline}</span>
          <span className="text-xs text-[var(--muted)]">{t('shopLine', { shop })}</span>
          {planLimit !== null && green ? (
            <span className="text-xs text-[var(--danger)]">{t('planLimit', { n: planLimit })}</span>
          ) : null}
          {state === 'error' && progress?.error ? (
            <span className="text-xs text-[var(--muted)] break-all">{progress.error}</span>
          ) : null}
          {state === 'token_invalid' ? (
            <span className="text-xs text-[var(--muted)]">{t('tokenInvalidHint')}</span>
          ) : null}
          {green && conn.lastWebhookAtIso ? (
            <span className="text-xs text-[var(--muted)]">
              {t('lastWebhook', {
                ago: relativeAgo(now - new Date(conn.lastWebhookAtIso).getTime(), t)
              })}
            </span>
          ) : null}
          {green && !conn.lastWebhookAtIso ? (
            <span className="text-xs text-[var(--muted)]">{t('noWebhookYet')}</span>
          ) : null}
        </div>
      </div>

      {state !== 'revoked' ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={syncNow}
            disabled={pending || state === 'syncing' || state === 'token_invalid'}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--default)]/60 disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {state === 'syncing' ? t('syncRunning') : t('syncNow')}
          </button>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-50"
          >
            <Unplug className="size-3.5" aria-hidden />
            {t('disconnect')}
          </button>
          {failed ? (
            <span role="alert" className="text-xs text-[var(--danger)]">
              {t('actionFailed')}
            </span>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t('disconnectConfirmTitle')}
        description={
          <span className="flex flex-col gap-2">
            <span>{t('disconnectConfirmBody')}</span>
            <a
              href={WIX_MANAGE_APPS_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
            >
              {t('openWixDashboard')}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </span>
        }
        confirmLabel={t('disconnectConfirm')}
        cancelLabel={t('cancel')}
        isPending={pending}
        onConfirm={disconnect}
      />
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
