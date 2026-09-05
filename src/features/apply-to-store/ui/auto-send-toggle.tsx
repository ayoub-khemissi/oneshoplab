'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setAutoApplyAction } from '../api/auto-send-action';

/**
 * "Send changes automatically", per store.
 *
 * Off by default and deliberately not an account setting: this writes into a
 * live catalogue with no review, which is a decision a merchant makes for a
 * shop they trust — not for all of them at once. The hint says plainly what it
 * does and that undo still exists, because the toggle alone would not.
 */
export function AutoSendToggle({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const t = useTranslations('SiteStatus');
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [saved, setSaved] = useState(false);
  const [busy, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    setSaved(false);
    startTransition(async () => {
      const res = await setAutoApplyAction(projectId, next);
      if (!res.ok) {
        setOn(!next); // The store refused it; don't pretend otherwise.
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-semibold">{t('autoSendTitle')}</h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">{t('autoSendHint')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t('autoSendTitle')}
          onClick={toggle}
          disabled={busy}
          data-testid="auto-send-toggle"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            on ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]/30'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform ${
              on ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>
      {saved ? (
        <p role="status" className="text-xs text-[var(--success)]">
          {t('autoSendSaved')}
        </p>
      ) : null}
    </section>
  );
}
