'use client';

import { Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type MouseEvent } from 'react';
import { deleteProjectAction } from '../api/actions';

interface DeleteSiteButtonProps {
  projectId: string;
  domain: string;
}

/**
 * Trash button shown on each dashboard site card. Two-step:
 *   1. Click → swaps the icon for a small "Delete?" confirm + dismiss
 *      pair (matches the share-link revoke pattern).
 *   2. Confirm → server action does a hard delete (FK cascades remove
 *      audits / jobs / products / share links). Card disappears via
 *      revalidatePath('/dashboard').
 *
 * Lives inside the SiteCard <Link>, so every interactive element here
 * stops propagation + prevents default to keep the wrapping anchor
 * from navigating when the merchant just wants to delete.
 */
export function DeleteSiteButton({ projectId, domain }: DeleteSiteButtonProps) {
  const t = useTranslations('Dashboard');
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function swallow(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function openConfirm(e: MouseEvent) {
    swallow(e);
    setConfirming(true);
  }

  function dismiss(e: MouseEvent) {
    swallow(e);
    setConfirming(false);
  }

  function handleDelete(e: MouseEvent) {
    swallow(e);
    const formData = new FormData();
    formData.set('projectId', projectId);
    startTransition(async () => {
      await deleteProjectAction(formData);
      // No setConfirming(false) — by the time the action returns the
      // server's revalidatePath has already triggered an unmount of
      // this component (the parent list no longer contains the row).
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={openConfirm}
        aria-label={t('deleteSiteAria', { domain })}
        title={t('deleteSiteAria', { domain })}
        className="size-8 rounded-md inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
      >
        <Trash2 className="size-4" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="text-xs font-medium px-2 py-1 rounded bg-[var(--danger)] text-[var(--danger-foreground)] hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t('deleteSitePending') : t('deleteSiteConfirm')}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('cancel') ?? 'Cancel'}
        className="size-7 rounded-md hover:bg-[var(--default)] inline-flex items-center justify-center"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
