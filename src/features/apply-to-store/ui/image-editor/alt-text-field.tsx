'use client';

import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Alt text is capped at 125 characters: screen readers and search engines
 *  both stop reading long alternatives, and the store fields are short. */
const ALT_MAX = 125;

/**
 * Inline alt-text editor of one tile. Says what the text is for — it is the
 * one image action that never touches the merchant's visuals, so it should
 * read as an SEO/accessibility win, not as a technical field.
 */
export function AltTextField({
  value,
  label,
  onSave,
  onCancel
}: {
  value: string | null;
  /** Photo name, for the field's accessible label ("Photo 2"). */
  label: string;
  onSave: (alt: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('ProductImages');
  const [draft, setDraft] = useState(value ?? '');

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft.trim().slice(0, ALT_MAX));
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="sr-only">{t('altFieldLabel', { photo: label })}</span>
        <input
          type="text"
          name="alt"
          autoFocus
          value={draft}
          maxLength={ALT_MAX}
          placeholder={t('altPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={t('altFieldLabel', { photo: label })}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </label>
      <p className="text-[10px] leading-snug text-[var(--muted)]">{t('altHint')}</p>
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          data-testid="alt-save"
          className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-[var(--accent-foreground)] hover:opacity-90"
        >
          <Check className="size-3" aria-hidden /> {t('altSave')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] hover:border-[var(--danger)] hover:text-[var(--danger)]"
        >
          <X className="size-3" aria-hidden /> {t('altCancel')}
        </button>
        <span className="ml-auto text-[10px] tabular-nums text-[var(--muted)]">
          {draft.length}/{ALT_MAX}
        </span>
      </div>
    </form>
  );
}
