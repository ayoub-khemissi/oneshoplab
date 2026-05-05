'use client';

import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IMAGE_RETENTION_DAYS } from '@/lib/ai/models';

interface ImageExpiryProps {
  /** When the source generation was recorded. */
  createdAt: Date;
  className?: string;
}

/**
 * Subtle one-line caption rendered next to a generated-image grid:
 * "Auto-deleted in 23 days · 28/05/2026". Computed live from the
 * generation timestamp so the same retention rule the worker enforces
 * is what the merchant sees.
 */
export function ImageExpiry({ createdAt, className }: ImageExpiryProps) {
  const t = useTranslations('ImageExpiry');
  const expiresAt = new Date(createdAt.getTime() + IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const msLeft = expiresAt.getTime() - Date.now();
  if (msLeft <= 0) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] text-[var(--danger)] ${className ?? ''}`}
      >
        <Clock className="size-3" aria-hidden />
        <span>{t('expired')}</span>
      </span>
    );
  }
  const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
  const tone = daysLeft <= 3 ? 'text-[var(--warning)]' : 'text-[var(--muted)]';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] ${tone} ${className ?? ''}`}
      title={t('tooltip', { date: expiresAt.toLocaleDateString() })}
    >
      <Clock className="size-3" aria-hidden />
      <span>{t('inDays', { days: daysLeft })}</span>
    </span>
  );
}
