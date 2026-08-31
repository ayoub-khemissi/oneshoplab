'use client';

import { ChevronDown, ChevronRight, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { formatDate } from '@/shared/lib';
import { ConfirmDialog } from '@/shared/ui';
import { revokeSiteKeyAction, rotateSiteKeyAction } from '../api/actions';
import { MAX_PAST_KEYS_SHOWN, partitionSiteKeys } from '../lib/key-state';
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
  const [showPast, setShowPast] = useState(false);
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

  const { live, past } = partitionSiteKeys(keys);
  const pastShown = past.slice(0, MAX_PAST_KEYS_SHOWN);
  const pastHidden = past.length - pastShown.length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)] leading-relaxed">{t('keysHint')}</p>
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {live.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="site-keys-live">
          {live.map((key) => (
            <KeyRow key={key.id} entry={key} onDialog={setDialog} />
          ))}
        </ul>
      ) : null}

      {past.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            data-testid="site-keys-past-toggle"
            aria-expanded={showPast}
            className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {showPast ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
            {t('keysPastToggle', { count: past.length })}
          </button>
          {showPast ? (
            <>
              <ul className="flex flex-col gap-2" data-testid="site-keys-past">
                {pastShown.map((key) => (
                  <KeyRow key={key.id} entry={key} onDialog={setDialog} />
                ))}
              </ul>
              {pastHidden > 0 ? (
                <p className="text-[11px] text-[var(--muted)]">
                  {t('keysPastMore', { count: pastHidden })}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

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

function KeyRow({ entry, onDialog }: { entry: SiteKeySummary; onDialog: (d: Dialog) => void }) {
  const t = useTranslations('Integrations');
  return (
    <li
      data-state={entry.state}
      className="flex flex-col gap-2 md:flex-row md:items-center p-3 rounded-md bg-[var(--default)]/40 border border-[var(--border)]"
    >
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <KeyRound className="size-3.5 text-[var(--muted)]" aria-hidden />
          <span className="text-sm font-medium">{entry.name}</span>
          <code className="text-xs font-mono text-[var(--muted)]">{entry.prefix}…</code>
          <StateBadge state={entry.state} />
        </div>
        <span className="text-[11px] text-[var(--muted)]">
          {t('keyCreated', { date: formatDate(entry.createdAtIso) })}
          {' · '}
          {entry.lastUsedAtIso
            ? t('keyLastUsed', { date: formatDate(entry.lastUsedAtIso) })
            : t('keyNeverUsed')}
          {' · '}
          {entry.expiresAtIso
            ? t('keyExpires', { date: formatDate(entry.expiresAtIso) })
            : t('keyNoExpiry')}
          {entry.state === 'grace' && entry.graceUntilIso
            ? ` · ${t('keyGrace', { date: formatDate(entry.graceUntilIso) })}`
            : ''}
        </span>
      </div>
      {entry.state === 'active' ? (
        <div className="flex items-center gap-1.5 justify-end shrink-0">
          <button
            type="button"
            onClick={() => onDialog({ kind: 'rotate', key: entry })}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] inline-flex items-center gap-1.5"
          >
            <RefreshCw className="size-3.5" aria-hidden /> {t('rotate')}
          </button>
          <button
            type="button"
            onClick={() => onDialog({ kind: 'revoke', key: entry })}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:border-[var(--danger)] hover:text-[var(--danger)] inline-flex items-center gap-1.5"
          >
            <Trash2 className="size-3.5" aria-hidden /> {t('revoke')}
          </button>
        </div>
      ) : null}
    </li>
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
