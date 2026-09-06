'use client';

import { Spinner } from '@heroui/react';
import { AlertTriangle, Check, Clock, RotateCcw, Store, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { ConfirmDialog } from '@/shared/ui';
import { approveGenerationAction, cancelChangeAction, undoChangeAction } from '../api/actions';
import type { ChangeSummary } from '../model/types';

type Dialog = 'replace_all' | 'undo' | null;

/**
 * Per-generation "Apply to store" control. idle → pending (plugin picks it
 * up) → applied / conflict / failed. Without a site key the button is
 * replaced by a hint pointing at the Integrations tab.
 *
 * Images on a store OSL cannot address image by image go through the
 * replace-all path (docs/api/IMAGE-OPS.md §5): the merchant is told, in their
 * own words and with the real counts, exactly which photos leave the product
 * before anything is queued. Cancel is the default answer.
 */
export function ApplyToStoreButton({
  jobId,
  siteId,
  initialChange,
  canApplyToStore,
  appliesVia = 'plugin',
  disabled = false,
  field,
  replaceAllImages = false,
  currentImageCount = 0,
  generatedImageCount = 0
}: {
  jobId: string;
  siteId: string;
  initialChange: ChangeSummary | null;
  canApplyToStore: boolean;
  /** How the change reaches the store. A connector (Shopify, Wix) applies
   *  within seconds; the plugin polls, so it can be minutes. Saying "waiting
   *  for your plugin" to a merchant who never installed one is nonsense. */
  appliesVia?: 'connector' | 'plugin';
  /** Archived products cannot be written back. */
  disabled?: boolean;
  /** Which field this generation rewrites — only `images` can replace a gallery. */
  field?: 'title' | 'description' | 'tags' | 'images';
  /** The connection reported no stable image ids → applying replaces the gallery. */
  replaceAllImages?: boolean;
  /** Photos currently on the product, and generated visuals about to replace them. */
  currentImageCount?: number;
  generatedImageCount?: number;
}) {
  const t = useTranslations('ApplyToStore');
  const router = useRouter();
  const [change, setChange] = useState<ChangeSummary | null>(initialChange);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();

  const needsReplaceAllConfirm =
    field === 'images' && replaceAllImages && currentImageCount > 0 && change?.status !== 'pending';

  function approve() {
    const fd = new FormData();
    fd.set('jobId', jobId);
    setError(null);
    startTransition(async () => {
      const res = await approveGenerationAction(fd);
      if (res.ok) {
        setChange(res.change);
        // The pending-changes panel is server-rendered: without this it keeps
        // saying "0 en attente" next to a chip that says the opposite.
        router.refresh();
      } else if (res.error === 'invalid_value') {
        // The generation is now appended to the gallery rather than replacing
        // it, so a product already at the store's cap has nowhere to put it.
        setError(t('errorImageLimit'));
      } else setError(t('errorGeneric'));
      setDialog(null);
    });
  }

  function cancel() {
    if (!change) return;
    const fd = new FormData();
    fd.set('projectId', siteId);
    fd.set('changeId', change.id);
    startTransition(async () => {
      const res = await cancelChangeAction(fd);
      if (res.ok) {
        setChange(null);
        router.refresh();
      } else setError(t('errorGeneric'));
    });
  }

  function undo() {
    if (!change) return;
    const fd = new FormData();
    fd.set('projectId', siteId);
    fd.set('changeId', change.id);
    setError(null);
    startTransition(async () => {
      const res = await undoChangeAction(fd);
      if (res.ok) {
        setUndone(true);
        router.refresh();
      } else setError(res.error === 'conflict' ? t('undoBlocked') : t('undoUnavailable'));
      setDialog(null);
    });
  }

  if (!canApplyToStore) {
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
            <Clock className="size-3.5" aria-hidden />{' '}
            {appliesVia === 'connector' ? t('pending') : t('pendingPlugin')}
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
        <>
          <span className="inline-flex items-center gap-1.5 text-[var(--success)] font-medium">
            <Check className="size-3.5" aria-hidden /> {t('applied')}
          </span>
          {undone ? (
            <span className="text-[var(--muted)]">{t('undoQueued')}</span>
          ) : (
            <button
              type="button"
              onClick={() => setDialog('undo')}
              disabled={pending || disabled}
              className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--foreground)] underline underline-offset-2 disabled:opacity-50"
            >
              <RotateCcw className="size-3" aria-hidden /> {t('undo')}
            </button>
          )}
        </>
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
            onClick={() => (needsReplaceAllConfirm ? setDialog('replace_all') : approve())}
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

      <ConfirmDialog
        isOpen={dialog === 'replace_all'}
        onOpenChange={(open) => setDialog(open ? 'replace_all' : null)}
        title={t('replaceAllTitle')}
        description={t('replaceAllBody', {
          current: currentImageCount,
          generated: generatedImageCount
        })}
        confirmLabel={t('replaceAllConfirm')}
        cancelLabel={t('replaceAllCancel')}
        isPending={pending}
        onConfirm={approve}
      />
      <ConfirmDialog
        isOpen={dialog === 'undo'}
        onOpenChange={(open) => setDialog(open ? 'undo' : null)}
        title={t('undoTitle')}
        description={t('undoBody')}
        confirmLabel={t('undoConfirm')}
        cancelLabel={t('replaceAllCancel')}
        destructive={false}
        isPending={pending}
        onConfirm={undo}
      />
    </div>
  );
}
