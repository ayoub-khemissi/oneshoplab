'use client';

import { Spinner } from '@heroui/react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { formatDate } from '@/shared/lib';
import { CopyButton } from '@/shared/ui';
import { createSiteKeyAction } from '../api/actions';
import type { KeyActionResult, SiteKeySummary } from '../model/types';

/** Plaintext shown exactly once (after create or rotate) with Copy + "I saved it". */
export function KeyReveal({ plaintext, onSaved }: { plaintext: string; onSaved: () => void }) {
  const t = useTranslations('Integrations');
  return (
    <div className="rounded-md border border-[var(--success)]/40 bg-[var(--success)]/5 p-4 flex flex-col gap-3">
      <span className="text-sm font-semibold inline-flex items-center gap-2">
        <ShieldCheck className="size-4 text-[var(--success)]" aria-hidden />
        {t('keyRevealTitle')}
      </span>
      <div className="flex items-center gap-2 flex-wrap">
        <code
          data-testid="site-key-plaintext"
          className="text-xs font-mono px-2 py-1.5 rounded bg-[var(--background)] border border-[var(--border)] break-all select-all"
        >
          {plaintext}
        </code>
        <CopyButton value={plaintext} label={t('copy')} copiedLabel={t('copied')} size="md" />
      </div>
      <button
        type="button"
        onClick={onSaved}
        className="self-start px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90"
      >
        {t('keySavedButton')}
      </button>
    </div>
  );
}

export function SiteKeyStep({
  projectId,
  activeKey,
  revealed,
  onCreated,
  onSaved
}: {
  projectId: string;
  /** Usable key already on the project (created earlier, or just now). */
  activeKey: SiteKeySummary | null;
  revealed: string | null;
  onCreated: (result: Extract<KeyActionResult, { ok: true }>) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('Integrations');
  const [pending, startTransition] = useTransition();

  function generate() {
    const fd = new FormData();
    fd.set('projectId', projectId);
    startTransition(async () => {
      const res = await createSiteKeyAction(fd);
      if (res.ok) onCreated(res);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)] leading-relaxed">{t('step3Body')}</p>
      {revealed ? (
        <KeyReveal plaintext={revealed} onSaved={onSaved} />
      ) : activeKey ? (
        <p className="text-sm inline-flex items-center gap-2">
          <KeyRound className="size-4 text-[var(--success)]" aria-hidden />
          <span>
            <span className="font-medium">{t('keyExistsTitle')}</span>{' '}
            <span className="text-[var(--muted)]">
              {t('keyExistsBody', {
                prefix: activeKey.prefix,
                date: formatDate(activeKey.createdAtIso)
              })}
            </span>
          </span>
        </p>
      ) : (
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="self-start px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {pending ? <Spinner size="sm" /> : <KeyRound className="size-4" aria-hidden />}
          {pending ? t('generating') : t('generateKey')}
        </button>
      )}
    </div>
  );
}
