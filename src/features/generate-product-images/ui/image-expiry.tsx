'use client';

import { CalendarX, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { formatDate } from '@/shared/lib';

interface ImageExpiryProps {
  /** When the source generation was recorded. */
  createdAt: Date;
  /** Plan-specific retention window in days. Free/Starter pass 30,
   *  Pro 60, Scale 90 — derived server-side from the merchant's plan. */
  retentionDays: number;
  /** Tombstone date stamped by the r2-cleanup worker. When set the
   *  caption switches from a live countdown to a "Image expirée le
   *  {date}" past-tense label. Pass null/undefined for fresh entries
   *  that haven't crossed retention yet — the component will fall
   *  back to the computed expiresAt date if the row has already
   *  crossed the retention math but the worker hasn't run. */
  expiredAt?: Date | null;
  className?: string;
}

/**
 * Subtle one-line caption rendered next to a generated-image grid.
 * Three states:
 *   - Fresh: "Suppr. auto dans 23 jours" (live countdown)
 *   - Expired and tombstoned: "Image expirée le 28/05/2026"
 *   - Expired but worker hasn't run: "Image expirée" (no date)
 *
 * The expiry math (createdAt + retentionDays) is identical to what
 * the cleanup worker enforces, so the UI is never out of sync.
 */
export function ImageExpiry({ createdAt, retentionDays, expiredAt, className }: ImageExpiryProps) {
  const t = useTranslations('ImageExpiry');

  // The "days left" / expired branch depends on Date.now(), which is
  // never identical between the SSR render and client hydration →
  // React #418 text mismatch. Gate the whole caption behind a mount
  // flag: SSR and the first client render both return null (so they
  // match), then the real value is rendered post-hydration. The
  // caption is a tiny muted hint on a noindex page, so the ~0ms
  // appearance is imperceptible and SEO-irrelevant.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  const expiresAt = new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  const msLeft = expiresAt.getTime() - Date.now();
  const isExpired = expiredAt != null || msLeft <= 0;

  if (isExpired) {
    // Prefer the tombstone date when present, otherwise the computed
    // expiry date — the merchant cares "when did this disappear",
    // not "when did the worker happen to run".
    const expiryDate = expiredAt ?? expiresAt;
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] text-[var(--muted)] ${className ?? ''}`}
      >
        <CalendarX className="size-3" aria-hidden />
        <span>{t('expiredOn', { date: formatDate(expiryDate) })}</span>
      </span>
    );
  }
  const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
  const tone = daysLeft <= 3 ? 'text-[var(--warning)]' : 'text-[var(--muted)]';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] ${tone} ${className ?? ''}`}
      title={t('tooltip', { date: formatDate(expiresAt) })}
    >
      <Clock className="size-3" aria-hidden />
      <span>{t('inDays', { days: daysLeft })}</span>
    </span>
  );
}
