import { toast } from '@heroui/react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

export function useRecentFailedChatJobToasts(
  recentFailedChatJobs: ReadonlyArray<{ jobId: string }>
): void {
  const t = useTranslations('Product');
  // Surface chat-gen failures the merchant may have missed while
  // their tab was reloading. The server already filtered to "last
  // attempt per field, failed" within the recovery window; we just
  // need to fire one toast per jobId on mount and remember which IDs
  // we've already shown so a second F5 inside the same window doesn't
  // re-spam. localStorage keeps the dedup per-browser (sessionStorage
  // would forget across tabs, which is too narrow — we want "stop
  // showing this failure" to mean "across reloads", not "per tab").
  useEffect(() => {
    if (recentFailedChatJobs.length === 0) return;
    const SEEN_KEY = 'oneshoplab.chat-fail-seen';
    let seen: Set<string>;
    try {
      const raw = window.localStorage.getItem(SEEN_KEY);
      seen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      seen = new Set();
    }
    let dirty = false;
    for (const job of recentFailedChatJobs) {
      if (seen.has(job.jobId)) continue;
      seen.add(job.jobId);
      dirty = true;
      // Reuse the generic 'errorGenerationFailed' i18n key (already
      // present in all 13 locales) — adding per-field variants would
      // require 39 new translations and the UI doesn't gain much:
      // the user is on the product page, will retry, and the
      // attempted field is the one they last interacted with.
      toast.danger(t('errorGenerationFailed'));
      // Mark the failure notification as read — user has now
      // explicitly seen the failure (via toast). Best-effort.
      void fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: job.jobId })
      });
    }
    if (dirty) {
      try {
        // Bound the set so it doesn't grow unboundedly across months
        // of failures. 200 entries is plenty for a single merchant.
        const arr = Array.from(seen).slice(-200);
        window.localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
      } catch {
        // Quota / privacy mode — silently skip persistence.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
