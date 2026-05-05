'use client';

import { Cookie, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';

const STORAGE_KEY = 'oneshoplab.cookies-acknowledged.v1';

/**
 * Bottom-of-screen cookie banner. We only set strictly-necessary cookies
 * today (auth, locale, theme, anon-audit token) so the banner is purely
 * informational — a single "Got it" button dismisses it. If/when we add
 * non-essential cookies (analytics, ads), this component should grow into
 * a proper consent flow with granular toggles + persisted preferences;
 * keeping the storage key versioned makes that migration easy.
 */
export function CookieBanner() {
  const t = useTranslations('CookieBanner');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const ack = window.localStorage.getItem(STORAGE_KEY);
      if (!ack) setVisible(true);
    } catch {
      // localStorage may throw under privacy-mode quota errors. If it does,
      // stay quiet — re-prompting on every page is worse than missing the
      // banner once.
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* no-op */
    }
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('ariaLabel')}
      className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-auto sm:max-w-md z-50 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg p-4 flex items-start gap-3"
    >
      <Cookie className="size-4 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
      <div className="flex-1 flex flex-col gap-2 text-xs leading-relaxed">
        <p className="text-[var(--foreground)]">
          {t('body')}{' '}
          <Link
            href="/privacy"
            className="underline hover:text-[var(--accent)]"
          >
            {t('learnMore')}
          </Link>
          .
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-xs font-medium hover:opacity-90 transition-opacity"
          >
            {t('acknowledge')}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('close')}
        className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors -mr-1 -mt-1"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
