'use client';

import { Spinner, toast } from '@heroui/react';
import { Coins, Eraser } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorKeyFromCode } from './ai-image-grid/helpers';
import { refreshKeepingScroll } from '@/shared/lib';

interface RemoveBgSourceButtonProps {
  siteId: string;
  productId: string;
  /** One of the product's own store images. */
  sourceImageUrl: string;
  cost: number;
}

/**
 * "Transparent background" on a store original. The cut-out lands in the AI
 * grid next to the generations, so this only fires the job and wakes the
 * grid's poller (same event the Generate-all button uses).
 */
export function RemoveBgSourceButton({
  siteId,
  productId,
  sourceImageUrl,
  cost
}: RemoveBgSourceButtonProps) {
  const t = useTranslations('AiImageGrid');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch('/api/products/image-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, productId, op: 'remove_bg', sourceImageUrl })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.danger(t(errorKeyFromCode(body.error)));
        return;
      }
      toast.success(t('removeBgQueued'));
      window.dispatchEvent(
        new CustomEvent('oneshoplab:kick-image-poll', { detail: { siteId, productId } })
      );
      refreshKeepingScroll(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      aria-label={t('removeBgAria', { cost })}
      title={t('removeBgAria', { cost })}
      data-testid="remove-bg-source-button"
      className="inline-flex items-center gap-1 min-w-0 text-[11px] text-[var(--muted)] hover:text-[var(--accent)] disabled:opacity-50 transition-colors"
    >
      {busy ? <Spinner size="sm" /> : <Eraser className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{t('removeBg')}</span>
      <span className="font-mono inline-flex items-center gap-0.5 shrink-0">
        <Coins className="size-3" aria-hidden />
        {cost}
      </span>
    </button>
  );
}
