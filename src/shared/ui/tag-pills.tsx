'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CopyButton } from './copy-button';

export type TagDisplayMode = 'human' | 'slug';

/**
 * Slugify a single tag. Strips diacritics, lowercases, collapses any
 * non-alphanumeric run into a single dash, and trims leading/trailing
 * dashes. Matches the standard URL/slug format the merchant pastes into
 * their store backend (e.g. Shopify handle, WooCommerce slug).
 */
export function tagToSlug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

interface TagPillsProps {
  tags: string[];
  /** muted = source side, accent = AI side. */
  variant: 'muted' | 'accent';
  /** When set, also renders a Copy button next to the mode toggle that
   *  copies the currently-displayed (human or slug) form, comma-joined. */
  copyLabel?: string;
  copiedLabel?: string;
}

/**
 * Tag display + a small "Lisible / Slug" toggle. Most merchants want to
 * read the human form (capitalized, accents, spaces) but paste the slug
 * form (lowercase, ASCII, kebab-case) into their store backend — those
 * are the two real e-commerce conventions and the toggle covers both
 * without the merchant having to massage the output by hand.
 */
export function TagPills({ tags, variant, copyLabel, copiedLabel }: TagPillsProps) {
  const t = useTranslations('Report');
  const [mode, setMode] = useState<TagDisplayMode>('human');

  if (tags.length === 0) {
    return <p className="text-sm text-[var(--muted)] italic">—</p>;
  }
  const display = mode === 'slug' ? tags.map(tagToSlug) : tags;
  const pillClass =
    variant === 'accent'
      ? 'text-xs px-2 py-1 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
      : 'text-xs px-2 py-1 rounded bg-[var(--default)] text-[var(--muted)]';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <ModeToggle
          mode={mode}
          onChange={setMode}
          humanLabel={t('tagModeHuman')}
          slugLabel={t('tagModeSlug')}
        />
        {copyLabel && copiedLabel ? (
          <CopyButton value={display.join(', ')} label={copyLabel} copiedLabel={copiedLabel} />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {display.map((tag, i) => (
          <span key={`${variant}-${i}-${tag}`} className={pillClass}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
  humanLabel,
  slugLabel
}: {
  mode: TagDisplayMode;
  onChange: (m: TagDisplayMode) => void;
  humanLabel: string;
  slugLabel: string;
}) {
  const baseClass = 'px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors';
  const activeClass = 'bg-[var(--accent)] text-[var(--accent-foreground)]';
  const inactiveClass = 'text-[var(--muted)] hover:text-[var(--foreground)]';
  return (
    <div
      role="group"
      className="inline-flex rounded-md border border-[var(--border)] overflow-hidden"
    >
      <button
        type="button"
        onClick={() => onChange('human')}
        className={`${baseClass} ${mode === 'human' ? activeClass : inactiveClass}`}
        aria-pressed={mode === 'human'}
      >
        {humanLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange('slug')}
        className={`${baseClass} ${mode === 'slug' ? activeClass : inactiveClass}`}
        aria-pressed={mode === 'slug'}
      >
        {slugLabel}
      </button>
    </div>
  );
}
