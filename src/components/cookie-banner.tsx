'use client';

import { Cookie, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@/i18n/navigation';
import { getAnalyticsConsent, setAnalyticsConsent } from '@/lib/consent';

const STORAGE_KEY = 'oneshoplab.cookies-acknowledged.v1';

/**
 * Bottom-of-screen cookie banner with two modes:
 *
 *  - **No analytics configured** (`NEXT_PUBLIC_GA_MEASUREMENT_ID` unset):
 *    purely informational, a single "Got it" dismiss — exactly the
 *    original behaviour. Nothing changes for visitors until GA is wired,
 *    so this is safe to ship inert.
 *  - **Analytics configured**: a minimal opt-in consent — Accept / Refuse.
 *    GA only loads on Accept (see <Analytics>). Default = no analytics.
 *
 * Branching on the public env keeps the two storage keys independent and
 * versioned so the consent migration the original comment foresaw is
 * exactly this commit.
 */
export function CookieBanner() {
  const t = useTranslations('CookieBanner');
  const [visible, setVisible] = useState(false);
  const gaEnabled = Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);

  useEffect(() => {
    try {
      if (gaEnabled) {
        if (getAnalyticsConsent() === 'unset') setVisible(true);
      } else {
        if (!window.localStorage.getItem(STORAGE_KEY)) setVisible(true);
      }
    } catch {
      // localStorage may throw under privacy-mode quota errors. Stay
      // quiet — re-prompting on every page is worse than missing it once.
    }
  }, [gaEnabled]);

  if (!visible || typeof document === 'undefined') return null;

  function acknowledgeOnly() {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* no-op */
    }
    setVisible(false);
  }

  function decide(value: 'granted' | 'denied') {
    setAnalyticsConsent(value);
    setVisible(false);
  }

  return createPortal(
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('ariaLabel')}
      style={{ position: 'fixed', zIndex: 100 }}
      className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-auto sm:max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)]/85 supports-[backdrop-filter]:bg-[var(--card)]/70 backdrop-blur-xl backdrop-saturate-150 shadow-xl p-4 flex items-start gap-3"
    >
      <Cookie className="size-4 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
      <div className="flex-1 flex flex-col gap-2 text-xs leading-relaxed">
        <p className="text-[var(--foreground)]">
          {gaEnabled ? t('bodyAnalytics') : t('body')}{' '}
          <Link href="/privacy" className="underline hover:text-[var(--accent)]">
            {t('learnMore')}
          </Link>
          .
        </p>
        <div className="flex justify-end gap-2">
          {gaEnabled ? (
            <>
              <button
                type="button"
                onClick={() => decide('denied')}
                className="px-3 py-1.5 rounded-md border border-[var(--border)] text-xs font-medium hover:border-[var(--accent)] transition-colors"
              >
                {t('refuse')}
              </button>
              <button
                type="button"
                onClick={() => decide('granted')}
                className="px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-xs font-medium hover:opacity-90 transition-opacity"
              >
                {t('accept')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={acknowledgeOnly}
              className="px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-xs font-medium hover:opacity-90 transition-opacity"
            >
              {t('acknowledge')}
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => (gaEnabled ? decide('denied') : acknowledgeOnly())}
        aria-label={t('close')}
        className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors -mr-1 -mt-1"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>,
    document.body
  );
}
