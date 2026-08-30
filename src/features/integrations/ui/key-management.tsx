'use client';

import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { formatDate } from '@/shared/lib';
import { ConfirmDialog } from '@/shared/ui';
import { revokeSiteKeyAction, rotateSiteKeyAction } from '../api/actions';
import type { KeyActionResult, SiteKeySummary } from '../model/types';

type Dialog = { kind: 'rotate' | 'revoke'; key: SiteKeySummary } | null;

export function KeyManagement({
  projectId,
  keys,
  onRotated,
  onRevoked
}: {
  projectId: string;
  keys: SiteKeySummary[];
  onRotated: (result: Extract<KeyActionResult, { ok: true }>, oldKeyId: string) => void;
  onRevoked: (keyId: string) => void;
}) {
  const t = useTranslations('Integrations');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!dialog) return;
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('keyId', dialog.key.id);
    const current = dialog;
    startTransition(async () => {
      if (current.kind === 'rotate') {
        const res = await rotateSiteKeyAction(fd);
        if (res.ok) onRotated(res, current.key.id);
        else setError(t('errorGeneric'));
      } else {
        const res = await revokeSiteKeyAction(fd);
        if (res.ok) onRevoked(current.key.id);
        else setError(t('errorGeneric'));
      }
      setDialog(null);
    });
  }

  if (keys.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)] leading-relaxed">{t('keysHint')}</p>
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {keys.map((key) => (
          <li
            key={key.id}
            className="flex flex-col gap-2 md:flex-row md:items-center p-3 rounded-md bg-[var(--default)]/40 border border-[var(--border)]"
          >
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <KeyRound className="size-3.5 text-[var(--muted)]" aria-hidden />
                <span className="text-sm font-medium">{key.name}</span>
                <code className="text-xs font-mono text-[var(--muted)]">{key.prefix}…</code>
                <StateBadge state={key.state} />
              </div>
              <span className="text-[11px] text-[var(--muted)]">
                {t('keyCreated', { date: formatDate(key.createdAtIso) })}
                {' · '}
                {key.lastUsedAtIso
                  ? t('keyLastUsed', { date: formatDate(key.lastUsedAtIso) })
                  : t('keyNeverUsed')}
                {' · '}
                {key.expiresAtIso
                  ? t('keyExpires', { date: formatDate(key.expiresAtIso) })
                  : t('keyNoExpiry')}
                {key.state === 'grace' && key.graceUntilIso
                  ? ` · ${t('keyGrace', { date: formatDate(key.graceUntilIso) })}`
                  : ''}
              </span>
            </div>
            {key.state === 'active' ? (
              <div className="flex items-center gap-1.5 justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'rotate', key })}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="size-3.5" aria-hidden /> {t('rotate')}
                </button>
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'revoke', key })}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:border-[var(--danger)] hover:text-[var(--danger)] inline-flex items-center gap-1.5"
                >
                  <Trash2 className="size-3.5" aria-hidden /> {t('revoke')}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        isOpen={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={dialog?.kind === 'revoke' ? t('revokeConfirmTitle') : t('rotateConfirmTitle')}
        description={dialog?.kind === 'revoke' ? t('revokeConfirmBody') : t('rotateConfirmBody')}
        confirmLabel={dialog?.kind === 'revoke' ? t('revokeConfirm') : t('rotateConfirm')}
        cancelLabel={t('cancel')}
        destructive={dialog?.kind === 'revoke'}
        isPending={pending}
        onConfirm={confirm}
      />
    </div>
  );
}

function StateBadge({ state }: { state: SiteKeySummary['state'] }) {
  const t = useTranslations('Integrations');
  const tone =
    state === 'active'
      ? 'bg-[var(--success)]/15 text-[var(--success)]'
      : state === 'grace'
        ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
        : 'bg-[var(--default)] text-[var(--muted)]';
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono font-semibold ${tone}`}
    >
      {t(`state.${state}`)}
    </span>
  );
}
