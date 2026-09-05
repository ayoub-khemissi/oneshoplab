'use client';

import { AlertTriangle, ArrowRight, Plug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { PendingChangesModal, type PendingChangeItem } from '@/features/apply-to-store/client';
import type { SiteStatus } from '../lib/resolve';

/**
 * The single line that replaced four stacked cards. It says one thing, and it
 * leads somewhere: the changes recap opens in place, the onboarding steps
 * navigate to the tab that carries them.
 */
export function SiteStatusLine({
  status,
  projectId,
  items
}: {
  status: SiteStatus | null;
  projectId: string;
  /** Feeds the recap the "changes" targets open — same modal as before. */
  items: PendingChangeItem[];
}) {
  const t = useTranslations('SiteStatus');
  const [open, setOpen] = useState(false);
  if (!status) return null;

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
    <div data-testid="site-status-line" data-kind={status.kind} className="flex min-w-0">
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
