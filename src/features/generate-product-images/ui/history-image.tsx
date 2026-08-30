'use client';

import { ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface Props {
  url: string;
}

/**
 * Renders a past-generation image with a graceful fallback when the
 * URL is dead — happens when the R2 cleanup worker has already
 * pruned the object (plan retention expired) but the job row is
 * still surfaced in history, or when a legacy job stored only the
 * short-lived kie temp URL without re-uploading to R2.
 *
 * Native `<img onError>` flips local state; the fallback panel
 * keeps the same square footprint as the image so the grid
 * doesn't reflow when several tiles are gone.
 */
export function HistoryImage({ url }: Props) {
  const t = useTranslations('Product');
  const [broken, setBroken] = useState(false);

  // Empty URL = explicit tombstone (the cleanup worker cleared the
  // result's persistedUrls). Treat it the same as a broken load.
  if (broken || !url) {
    return (
      <div
        className="block aspect-square overflow-hidden rounded-md border border-[var(--border)] bg-[var(--default)]/40 flex flex-col items-center justify-center gap-1 px-2 text-center"
        aria-label={t('historyImageUnavailable')}
        title={t('historyImageUnavailable')}
      >
        <ImageOff className="size-5 text-[var(--muted)]" aria-hidden />
        <span className="text-[10px] text-[var(--muted)] leading-tight">
          {t('historyImageUnavailable')}
        </span>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="block aspect-square overflow-hidden rounded-md border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover"
        onError={() => setBroken(true)}
      />
    </a>
  );
}
