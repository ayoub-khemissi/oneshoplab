'use client';

import { Bell, Share, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readPushDisabled, usePushSubscription } from '../model/use-push-subscription';

/** "Later" is honoured for this long before the question comes back. */
const SNOOZE_DAYS = 30;
const SNOOZED_UNTIL_KEY = 'osl.push-prompt-snoozed-until';
/**
 * Its own key: putting the install hint away must not put away the push
 * question that follows the install — that one has not been asked yet.
 */
const INSTALL_SNOOZED_UNTIL_KEY = 'osl.install-hint-snoozed-until';

/** A breath after arriving, so the card is not the first thing that moves. */
const SHOW_AFTER_MS = 2500;

/** Screens where a card at the bottom would be in the way of the task. */
const QUIET_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password', '/logout'];

function readSnoozedUntil(key: string): number {
  try {
    return Number(window.localStorage.getItem(key) ?? 0);
  } catch {
    return 0;
  }
}

function snooze(key: string) {
  try {
    window.localStorage.setItem(key, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Not remembering only means asking again next time.
  }
}

const isSnoozedNow = (key: string) =>
  typeof window !== 'undefined' && readSnoozedUntil(key) > Date.now();

/**
 * Offers push once, in our own words, before the browser's own prompt — which
 * cannot be asked twice and says nothing about why.
 *
 * It waits a beat after arrival, keeps off the screens where a task is
 * underway, and comes back a month after "Later". A device the browser already
 * allows is registered quietly, unless the merchant turned push off themselves.
 *
 * On an iPhone outside the home screen there is no push to ask for, so the same
 * card — never a second one — says how to install instead.
 */
export function PushOptInPrompt({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations('Push');
  const pathname = usePathname();
  const { status, isBusy, enable } = usePushSubscription();
  const [visible, setVisible] = useState(false);

  const quiet = QUIET_PATHS.some((path) => pathname.includes(path));

  useEffect(() => {
    if (!signedIn || quiet) return;
    // Already allowed and not switched off by hand: register silently rather
    // than asking a question whose answer is already yes.
    if (status === 'off' && !readPushDisabled()) {
      void enable();
      return;
    }
    if (status !== 'prompt' && status !== 'ios_install') return;
    const key = status === 'ios_install' ? INSTALL_SNOOZED_UNTIL_KEY : SNOOZED_UNTIL_KEY;
    if (isSnoozedNow(key)) return;
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [signedIn, quiet, status, enable]);

  if (!visible || (status !== 'prompt' && status !== 'ios_install')) return null;
  const isInstallHint = status === 'ios_install';

  const dismiss = () => {
    snooze(isInstallHint ? INSTALL_SNOOZED_UNTIL_KEY : SNOOZED_UNTIL_KEY);
    setVisible(false);
  };

  return (
    <div
      data-testid="push-opt-in"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg sm:inset-x-auto sm:right-4"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-start gap-3">
        {isInstallHint ? (
          <Share className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" aria-hidden />
        ) : (
          <Bell className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" aria-hidden />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-semibold">
            {isInstallHint ? t('installTitle') : t('promptTitle')}
          </span>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            {isInstallHint ? t('installLead') : t('promptLead')}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('later')}
          className="ml-auto -mr-1 -mt-1 rounded-md p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {isInstallHint ? null : (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--default)]"
          >
            {t('later')}
          </button>
          <button
            type="button"
            disabled={isBusy}
            data-testid="push-opt-in-accept"
            onClick={() => void enable().then((ok) => ok && setVisible(false))}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-60"
          >
            {t('enable')}
          </button>
        </div>
      )}
    </div>
  );
}
