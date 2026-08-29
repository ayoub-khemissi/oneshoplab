'use client';

import { Home } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { setShareLinkHomeOrderAction, setShareLinkShowOnHomeAction } from '@/lib/share/actions';

interface ShowOnHomeToggleProps {
  linkId: string;
  siteId: string;
  value: boolean;
  onChange: (next: boolean) => void;
}

export function ShowOnHomeToggle({ linkId, siteId, value, onChange }: ShowOnHomeToggleProps) {
  const t = useTranslations('Share');
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = !value;
    // Optimistic flip — server result reconciles via revalidate.
    onChange(next);
    const formData = new FormData();
    formData.set('linkId', linkId);
    formData.set('siteId', siteId);
    formData.set('showOnHome', next ? '1' : '0');
    startTransition(async () => {
      const res = await setShareLinkShowOnHomeAction(formData);
      if (!res.ok) onChange(value);
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      aria-pressed={value}
      title={value ? t('hideFromHome') : t('showOnHomeAria')}
      className={`size-8 rounded-md inline-flex items-center justify-center transition-colors ${
        value
          ? 'bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25'
          : 'hover:bg-[var(--default)] text-[var(--muted)]'
      } disabled:opacity-50`}
    >
      <Home className="size-4" aria-hidden />
    </button>
  );
}

interface HomeOrderInputProps {
  linkId: string;
  siteId: string;
  value: number | null;
  onChange: (next: number | null) => void;
}

/**
 * Tiny number input used to pin the link's order in the home showcase.
 * Lower numbers come first within the visitor's language tier; empty
 * means "unranked" and the row trails by recency. Saves on blur to
 * keep the keystroke chatter low — admins can correct typos before
 * the network round-trip.
 */
export function HomeOrderInput({ linkId, siteId, value, onChange }: HomeOrderInputProps) {
  const t = useTranslations('Share');
  const [draft, setDraft] = useState<string>(value === null ? '' : String(value));
  const [pending, startTransition] = useTransition();

  // Reconcile when the parent updates (e.g. after another optimistic
  // change reverts the server-rejected value).
  useEffect(() => {
    setDraft(value === null ? '' : String(value));
  }, [value]);

  function commit(): void {
    const trimmed = draft.trim();
    let next: number | null = null;
    if (trimmed !== '') {
      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 9999) {
        // Invalid → snap back to the persisted value.
        setDraft(value === null ? '' : String(value));
        return;
      }
      next = parsed;
    }
    if (next === value) return;
    onChange(next);
    const formData = new FormData();
    formData.set('linkId', linkId);
    formData.set('siteId', siteId);
    formData.set('homeOrder', next === null ? '' : String(next));
    startTransition(async () => {
      const res = await setShareLinkHomeOrderAction(formData);
      if (!res.ok) {
        // Server rejected → revert.
        onChange(value);
        setDraft(value === null ? '' : String(value));
      }
    });
  }

  return (
    <input
      id="share-home-order"
      type="number"
      inputMode="numeric"
      min={1}
      max={9999}
      value={draft}
      placeholder={t('homeOrderPlaceholder')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
      disabled={pending}
      aria-label={t('homeOrderAria')}
      title={t('homeOrderAria')}
      className="w-12 h-8 px-1.5 rounded-md text-center text-xs font-mono border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none bg-[var(--background)] disabled:opacity-50"
    />
  );
}
