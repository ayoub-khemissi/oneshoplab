'use client';

import { Download, Loader2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * Downloads the CSV through fetch rather than a plain link, so the rate
 * limiter can speak: a refused download shows "try again in N seconds"
 * inline instead of navigating the merchant to a JSON error page.
 */
export function ExportButton({
  href,
  label,
  compact = false,
  labelOnDesktop = false
}: {
  href: string;
  label: string;
  /** Icon only. Used per row, where a label would stretch the column. */
  compact?: boolean;
  /** Compact on a phone, icon + label from `md` up. For headers, where the
   *  room exists and a bare icon reads as a guess. */
  labelOnDesktop?: boolean;
}) {
  const t = useTranslations('ExportCatalog');
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function download() {
    if (state === 'busy') return;
    setState('busy');
    setMessage(null);
    try {
      const res = await fetch(href, { headers: { Accept: 'text/csv' } });
      if (res.status === 429) {
        const body = (await res.json().catch(() => null)) as { retryAfterSec?: number } | null;
        setMessage(t('rateLimited', { seconds: body?.retryAfterSec ?? 60 }));
        setState('error');
        return;
      }
      if (!res.ok) {
        setMessage(t('failed'));
        setState('error');
        return;
      }
      const blob = await res.blob();
      const name =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'export.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the download in Safari.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState('idle');
    } catch {
      setMessage(t('failed'));
      setState('error');
    }
  }

  const busy = state === 'busy';
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-label={label}
        title={label}
        className={
          compact
            ? [
                'inline-flex items-center justify-center gap-1.5 h-8 rounded-md border',
                'border-[var(--border)] text-[var(--muted)] hover:text-[var(--accent)]',
                'hover:border-[var(--accent)] transition-colors disabled:opacity-50',
                labelOnDesktop ? 'px-2 md:px-2.5' : 'w-8'
              ].join(' ')
            : 'inline-flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50'
        }
      >
        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4 shrink-0" aria-hidden />
        )}
        {compact ? (
          labelOnDesktop ? (
            <span className="hidden md:inline text-sm font-medium whitespace-nowrap">
              {busy ? t('preparing') : label}
            </span>
          ) : null
        ) : (
          <span>{busy ? t('preparing') : label}</span>
        )}
      </button>
      {message ? (
        <span className="inline-flex items-center gap-1 text-xs text-red-500" role="status">
          <TriangleAlert className="size-3.5" aria-hidden />
          {message}
        </span>
      ) : null}
    </span>
  );
}
