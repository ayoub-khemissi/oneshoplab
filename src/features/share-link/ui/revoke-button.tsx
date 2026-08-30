'use client';

import { Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { revokeShareLinkAction } from '../api/actions';

interface RevokeButtonProps {
  linkId: string;
  siteId: string;
  onDone: () => void;
}

export function RevokeButton({ linkId, siteId, onDone }: RevokeButtonProps) {
  const t = useTranslations('Share');
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function handleRevoke() {
    const formData = new FormData();
    formData.set('linkId', linkId);
    formData.set('siteId', siteId);
    startTransition(async () => {
      const res = await revokeShareLinkAction(formData);
      if (res.ok) onDone();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={t('revokeAria')}
        title={t('revokeAria')}
        className="size-8 rounded-md hover:bg-[var(--default)] hover:text-[var(--danger)] inline-flex items-center justify-center"
      >
        <Trash2 className="size-4" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleRevoke}
        disabled={pending}
        className="text-xs font-medium px-2 py-1 rounded bg-[var(--danger)] text-[var(--danger-foreground)] hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t('revokingShort') : t('revokeConfirm')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        aria-label={t('cancel')}
        className="size-7 rounded-md hover:bg-[var(--default)] inline-flex items-center justify-center"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
