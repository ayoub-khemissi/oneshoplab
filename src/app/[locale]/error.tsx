'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Link } from '@/i18n/navigation';

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('Errors');

  useEffect(() => {
    // Surface the error to the browser console so devtools / Sentry-
    // like collectors can pick it up. The `digest` is the only piece
    // of info we can share with users to correlate against server
    // logs without leaking the stack trace.
    console.error('[error.tsx]', error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="flex flex-col items-center text-center gap-5 max-w-md">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--default)]/60 text-[var(--muted)]">
          <AlertTriangle className="size-8" aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            500
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('errorTitle')}
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {t('errorBody')}
          </p>
          {error.digest ? (
            <p className="text-[10px] font-mono text-[var(--muted)]/70 mt-1 break-all">
              ref: {error.digest}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 transition-opacity"
          >
            <RotateCcw className="size-4" aria-hidden />
            {t('errorRetry')}
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--default)]/40 transition-colors"
          >
            {t('errorHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
