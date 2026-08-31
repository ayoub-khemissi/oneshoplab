import { AlertTriangle, Bell, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { PendingCounts } from '../model/types';

/**
 * Site-card counter on the dashboard home. It links to the store's
 * Integrations tab — the one place that lists everything waiting — rather than
 * opening a modal from a card the merchant has not chosen yet.
 */
export function PendingChangesPill({
  projectId,
  counts
}: {
  projectId: string;
  counts: PendingCounts;
}) {
  const t = useTranslations('PendingChanges');
  if (counts.total === 0) return null;

  const tone =
    counts.failed > 0
      ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
      : counts.conflict > 0
        ? 'bg-[var(--warning,var(--danger))]/10 text-[var(--warning,var(--danger))]'
        : 'bg-[var(--accent)]/10 text-[var(--accent)]';

  return (
    <Link
      href={`/dashboard/sites/${projectId}?tab=integrations`}
      data-testid="pending-changes-pill"
      data-count={counts.total}
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium hover:underline ${tone}`}
    >
      {counts.failed > 0 ? (
        <XCircle className="size-3" aria-hidden />
      ) : counts.conflict > 0 ? (
        <AlertTriangle className="size-3" aria-hidden />
      ) : (
        <Bell className="size-3" aria-hidden />
      )}
      {t('pill', { count: counts.total })}
    </Link>
  );
}
