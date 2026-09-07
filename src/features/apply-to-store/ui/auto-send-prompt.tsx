'use client';

import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setAutoApplyAction } from '../api/auto-send-action';

/**
 * The "send automatically?" question, asked once, where it first matters.
 *
 * It is the same switch as the one in the site's settings — this only puts it
 * in front of the merchant at the moment a store gets connected, instead of
 * leaving them to discover it. Either answer is final for the prompt: the
 * settings keep the switch for changing one's mind, and this never comes back.
 */
export function AutoSendPrompt({ projectId }: { projectId: string }) {
  const t = useTranslations('SiteStatus');
  const router = useRouter();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [busy, start] = useTransition();

  function decide(enabled: boolean) {
    start(async () => {
      const res = await setAutoApplyAction(projectId, enabled);
      if (!res.ok) return;
      setAnswer(enabled);
      router.refresh();
    });
  }

  if (answer !== null) {
    return (
      <p
        role="status"
        data-testid="auto-send-prompt-done"
        className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]"
      >
        {answer ? t('autoSendPromptDoneOn') : t('autoSendPromptDoneOff')}
      </p>
    );
  }

  return (
    <section
      data-testid="auto-send-prompt"
      className="flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4"
    >
      <div className="flex items-start gap-3">
        <Send className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-semibold">{t('autoSendPromptTitle')}</h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">{t('autoSendPromptBody')}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:pl-7">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(true)}
          data-testid="auto-send-prompt-yes"
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-60"
        >
          {t('autoSendPromptYes')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(false)}
          data-testid="auto-send-prompt-no"
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:border-[var(--accent)] disabled:opacity-60"
        >
          {t('autoSendPromptNo')}
        </button>
      </div>
    </section>
  );
}
