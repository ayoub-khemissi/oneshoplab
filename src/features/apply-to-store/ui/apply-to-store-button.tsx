'use client';

import { Spinner } from '@heroui/react';
import { AlertTriangle, Check, Clock, Store, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { approveGenerationAction, cancelChangeAction } from '../api/actions';
import type { ChangeSummary } from '../model/types';

/**
 * Per-generation "Apply to store" control. idle → pending (plugin picks it
 * up) → applied / conflict / failed. Without a site key the button is
 * replaced by a hint pointing at the Integrations tab.
 */
export function ApplyToStoreButton({
  jobId,
  siteId,
  initialChange,
  hasSiteKey,
  disabled = false
}: {
  jobId: string;
  siteId: string;
  initialChange: ChangeSummary | null;
  hasSiteKey: boolean;
  /** Archived products cannot be written back. */
  disabled?: boolean;
}) {
  const t = useTranslations('ApplyToStore');
  const [change, setChange] = useState<ChangeSummary | null>(initialChange);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    const fd = new FormData();
    fd.set('jobId', jobId);
    setError(null);
    startTransition(async () => {
      const res = await approveGenerationAction(fd);
      if (res.ok) setChange(res.change);
      else setError(t('errorGeneric'));
    });
  }

  function cancel() {
    if (!change) return;
    const fd = new FormData();
    fd.set('projectId', siteId);
    fd.set('changeId', change.id);
    startTransition(async () => {
      const res = await cancelChangeAction(fd);
      if (res.ok) setChange(null);
      else setError(t('errorGeneric'));
    });
  }

  if (!hasSiteKey) {
    return (
      <p className="text-xs text-[var(--muted)] inline-flex items-center gap-1.5 flex-wrap">
        <Store className="size-3.5" aria-hidden />
        {t('noKeyHint')}{' '}
        <Link
          href={`/dashboard/sites/${siteId}?tab=integrations`}
          className="text-[var(--accent)] hover:underline font-medium"
        >
          {t('noKeyLink')}
        </Link>
      </p>
    );
  }

  const status = change?.status;
  const settled =
    status === 'cancelled' || status === 'expired' || status === 'skipped' || status === 'failed';

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      {status === 'pending' ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-[var(--muted)] font-medium">
            <Clock className="size-3.5" aria-hidden /> {t('pending')}
          </span>
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-50"
          >
            {pending ? <Spinner size="sm" /> : <X className="size-3" aria-hidden />} {t('cancel')}
          </button>
        </>
      ) : status === 'applied' ? (
        <span className="inline-flex items-center gap-1.5 text-[var(--success)] font-medium">
          <Check className="size-3.5" aria-hidden /> {t('applied')}
        </span>
      ) : status === 'conflict' ? (
        <span className="inline-flex items-start gap-1.5 text-[var(--warning,var(--danger))]">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">{t('conflict')}</span>{' '}
            <span className="text-[var(--muted)]">{t('conflictHint')}</span>
          </span>
        </span>
      ) : null}
      {status === undefined || settled ? (
        <>
          {status === 'failed' ? (
            <span className="text-[var(--danger)]">
              {t('failed', { error: change?.error ? ` — ${change.error}` : '' })}
            </span>
          ) : status === 'expired' ? (
            <span className="text-[var(--muted)]">{t('expired')}</span>
          ) : null}
          <button
            type="button"
            onClick={approve}
            disabled={pending || disabled}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? <Spinner size="sm" /> : <Store className="size-3.5" aria-hidden />}
            {status === undefined ? t('apply') : t('applyAgain')}
          </button>
        </>
      ) : null}
      {error ? (
        <span role="alert" className="text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
