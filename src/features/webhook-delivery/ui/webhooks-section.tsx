'use client';

import { Spinner } from '@heroui/react';
import { Send, Trash2, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState, useTransition } from 'react';
import type { OutboundWebhookView, WebhookDeliveryView } from '@/entities/outbound-webhook';
import { formatDate } from '@/shared/lib';
import { ConfirmDialog } from '@/shared/ui';
import {
  deleteWebhookAction,
  listDeliveriesAction,
  listWebhooksAction,
  sendPingAction
} from '../api/actions';
import { DeliveryLog, DeliveryStatus } from './delivery-log';
import { ManualWebhookForm } from './manual-webhook-form';

const LOG_SIZE = 20;
/** The worker picks a ping up within its 5 s tick; a slow receiver can take ~10 s more. */
const PING_POLL_MS = 2_000;
const PING_POLL_MAX = 10;

/**
 * "Avancé → Recevoir les changements immédiatement": collapsed by default,
 * loads on first open. Lists the project's webhooks (the plugin's own +
 * manual ones), test ping with its outcome, delivery log, "other
 * integration" form (secret shown once), delete behind a confirm.
 */
export function WebhooksSection({ projectId }: { projectId: string }) {
  const t = useTranslations('Integrations.webhooks');
  const [hooks, setHooks] = useState<OutboundWebhookView[] | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryView[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = useCallback(async () => {
    const [h, d] = await Promise.all([
      listWebhooksAction(projectId),
      listDeliveriesAction(projectId, LOG_SIZE)
    ]);
    if (!h.ok || !d.ok) {
      setLoadFailed(true);
      return;
    }
    setHooks(h.value);
    setDeliveries(d.value);
  }, [projectId]);

  return (
    <details
      data-testid="webhooks-section"
      className="rounded-xl border border-[var(--border)] bg-[var(--default)]/30 p-5"
      onToggle={(e) => {
        if (e.currentTarget.open && hooks === null) void reload();
      }}
    >
      <summary className="cursor-pointer select-none text-sm font-semibold inline-flex items-center gap-2">
        <Zap className="size-4 text-[var(--accent)]" aria-hidden />
        {t('advancedTitle')}
        <span className="text-xs font-normal text-[var(--muted)]">— {t('title')}</span>
      </summary>
      <div className="mt-4 flex flex-col gap-5">
        <p className="text-sm text-[var(--muted)] leading-relaxed max-w-2xl">{t('intro')}</p>

        {loadFailed ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {t('loadFailed')}
          </p>
        ) : hooks === null ? (
          <span className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
            <Spinner size="sm" /> {t('loading')}
          </span>
        ) : (
          <>
            <div className="flex flex-col gap-2" data-testid="webhook-list">
              <h4 className="text-sm font-semibold">{t('listTitle')}</h4>
              {hooks.length === 0 ? (
                <p className="text-xs text-[var(--muted)] italic" data-testid="webhook-list-empty">
                  {t('listEmpty')}
                </p>
              ) : (
                hooks.map((hook) => (
                  <WebhookRow
                    key={hook.id}
                    projectId={projectId}
                    hook={hook}
                    onChanged={reload}
                    onPingDelivery={(d) => setDeliveries((prev) => [d, ...prev].slice(0, LOG_SIZE))}
                  />
                ))
              )}
            </div>

            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">{t('logTitle')}</h4>
              <DeliveryLog deliveries={deliveries} />
            </div>

            <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
              <h4 className="text-sm font-semibold">{t('manualTitle')}</h4>
              <ManualWebhookForm projectId={projectId} onCreated={reload} />
            </div>
          </>
        )}
      </div>
    </details>
  );
}

type PingState =
  { kind: 'idle' } | { kind: 'waiting' } | { kind: 'done'; delivery: WebhookDeliveryView };

function WebhookRow({
  projectId,
  hook,
  onChanged,
  onPingDelivery
}: {
  projectId: string;
  hook: OutboundWebhookView;
  onChanged: () => Promise<void>;
  onPingDelivery: (d: WebhookDeliveryView) => void;
}) {
  const t = useTranslations('Integrations.webhooks');
  const [confirm, setConfirm] = useState(false);
  const [ping, setPing] = useState<PingState>({ kind: 'idle' });
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function sendTest() {
    setFailed(false);
    startTransition(async () => {
      const res = await sendPingAction(projectId, hook.id);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setPing({ kind: 'waiting' });
      const id = res.value.deliveryId;
      for (let i = 0; i < PING_POLL_MAX; i += 1) {
        await new Promise((r) => setTimeout(r, PING_POLL_MS));
        const list = await listDeliveriesAction(projectId, LOG_SIZE);
        const found = list.ok ? list.value.find((d) => d.id === id) : undefined;
        if (found && found.status !== 'pending') {
          setPing({ kind: 'done', delivery: found });
          onPingDelivery(found);
          return;
        }
      }
      setPing({ kind: 'idle' });
      setFailed(true);
    });
  }

  function remove() {
    setFailed(false);
    startTransition(async () => {
      const res = await deleteWebhookAction(projectId, hook.id);
      setConfirm(false);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      await onChanged();
    });
  }

  return (
    <div
      data-testid="webhook-row"
      data-kind={hook.kind}
      className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3 flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-medium">
          {t(`kind.${hook.kind}`)}
        </span>
        <span
          className={`font-medium ${hook.enabled ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
        >
          {hook.enabled ? t('enabled') : t('disabled')}
        </span>
        {!hook.enabled ? (
          <span className="text-[var(--muted)]">
            {t('disabledReason', { n: hook.failureStreak })}
          </span>
        ) : null}
      </div>
      <code className="text-xs font-mono break-all">{hook.url}</code>
      <span className="text-xs text-[var(--muted)]">
        {hook.lastDeliveryAt
          ? t('lastDelivery', {
              date: formatDate(hook.lastDeliveryAt),
              code: hook.lastStatus ?? '—'
            })
          : t('noDeliveryYet')}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={sendTest}
          disabled={pending || ping.kind === 'waiting'}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--default)]/60 disabled:opacity-50"
        >
          {ping.kind === 'waiting' ? (
            <Spinner size="sm" />
          ) : (
            <Send className="size-3.5" aria-hidden />
          )}
          {ping.kind === 'waiting' ? t('pingWaiting') : t('sendTest')}
        </button>
        {ping.kind === 'done' ? (
          <span className="text-xs inline-flex items-center gap-1" data-testid="ping-result">
            {t('pingResult')} <DeliveryStatus status={ping.delivery.status} />
            {ping.delivery.responseStatus !== null ? (
              <span className="font-mono text-[var(--muted)]">
                ({ping.delivery.responseStatus})
              </span>
            ) : null}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
          {t('delete')}
        </button>
        {failed ? (
          <span role="alert" className="text-xs text-[var(--danger)]">
            {t('actionFailed')}
          </span>
        ) : null}
      </div>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t('deleteConfirmTitle')}
        description={hook.kind === 'self' ? t('deleteConfirmSelf') : t('deleteConfirmManual')}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        isPending={pending}
        onConfirm={remove}
      />
    </div>
  );
}
