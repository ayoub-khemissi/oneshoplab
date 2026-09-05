'use client';

import { Spinner } from '@heroui/react';
import { AlertTriangle, ArrowRight, Plug, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import {
  PendingChangesModal,
  sendAllGenerationsAction,
  type PendingChangeItem
} from '@/features/apply-to-store/client';
import type { SiteStatus } from '../lib/resolve';

/**
 * The single line that replaced four stacked cards. It says one thing, and it
 * leads somewhere: the changes recap opens in place, the onboarding steps
 * navigate to the tab that carries them.
 */
export function SiteStatusLine({
  status,
  projectId,
  items,
  sendable = 0
}: {
  status: SiteStatus | null;
  projectId: string;
  /** Feeds the recap the "changes" targets open — same modal as before. */
  items: PendingChangeItem[];
  /** Generations this store made and never sent. Offered beside the message so
   *  a merchant clears a whole catalogue in one click rather than one per
   *  field, which is unclickable after a bulk run. */
  sendable?: number;
}) {
  const t = useTranslations('SiteStatus');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  function sendAll() {
    startTransition(async () => {
      await sendAllGenerationsAction(projectId);
      router.refresh();
    });
  }

  const sendAllButton =
    sendable > 0 ? (
      <button
        type="button"
        onClick={sendAll}
        disabled={busy}
        data-testid="site-send-all"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Spinner size="sm" /> : <Store className="size-3" aria-hidden />}
        {t('sendAll', { count: sendable })}
      </button>
    ) : null;

  if (!status) {
    return sendAllButton ? <div className="flex min-w-0">{sendAllButton}</div> : null;
  }

  const label = t(status.kind, { count: status.count ?? 0 });
  const tone =
    status.tone === 'danger'
      ? 'text-[var(--danger)]'
      : status.tone === 'accent'
        ? 'text-[var(--accent)]'
        : 'text-[var(--muted)]';

  const icon =
    status.tone === 'busy' ? (
      <PulsingDot />
    ) : status.tone === 'danger' ? (
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
    ) : status.kind === 'connectStore' ? (
      <Plug className="size-3.5 shrink-0" aria-hidden />
    ) : (
      <ArrowRight className="size-3.5 shrink-0" aria-hidden />
    );

  const body = (
    <span className={`inline-flex min-w-0 items-center gap-2 text-sm ${tone}`}>
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );

  return (
    <div
      data-testid="site-status-line"
      data-kind={status.kind}
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
    >
      {status.target === 'changes' ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-w-0 items-center gap-1.5 hover:underline underline-offset-2"
          >
            {body}
          </button>
          <PendingChangesModal
            isOpen={open}
            onOpenChange={setOpen}
            projectId={projectId}
            items={items}
          />
        </>
      ) : status.target ? (
        <Link
          href={`/dashboard/sites/${projectId}?tab=${status.target}`}
          className="inline-flex min-w-0 items-center gap-1.5 hover:underline underline-offset-2"
        >
          {body}
        </Link>
      ) : (
        body
      )}
      {sendAllButton}
    </div>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex size-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-[var(--accent)]" />
    </span>
  );
}
