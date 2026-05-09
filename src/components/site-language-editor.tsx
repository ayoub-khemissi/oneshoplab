'use client';

import {
  Autocomplete,
  Card,
  EmptyState,
  Label,
  ListBox,
  SearchField,
  Spinner,
  useFilter,
  type Key
} from '@heroui/react';
import { Check, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { LANGUAGES } from '@/lib/i18n/languages';
import { updateProjectLanguageAction } from '@/lib/auth-actions';

interface SiteLanguageEditorProps {
  projectId: string;
  /** Currently persisted override on the project, or null when on auto-detect. */
  initialOverride: string | null;
  /** Latest audit-detected language. Used as the visible default when there
   *  is no override yet. */
  detectedLanguage: string | null;
}

/**
 * Site-wide language picker on the per-site dashboard. Persisting any
 * value (including the detected one re-confirmed) writes the override
 * column; clearing the dropdown reverts the project to auto-detection.
 * The chosen language is consumed by every AI generation on this site.
 */
export function SiteLanguageEditor({
  projectId,
  initialOverride,
  detectedLanguage
}: SiteLanguageEditorProps) {
  const t = useTranslations('SiteLanguage');
  const { contains } = useFilter({ sensitivity: 'base' });

  const initialKey = initialOverride ?? detectedLanguage ?? null;
  const [selected, setSelected] = useState<Key | null>(initialKey);
  const [savedOverride, setSavedOverride] = useState<string | null>(initialOverride);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = (selected ?? null) !== (savedOverride ?? detectedLanguage ?? null);
  const isCustom = savedOverride !== null;

  function handleSubmit(formData: FormData) {
    const next = typeof selected === 'string' ? selected : '';
    startTransition(async () => {
      await updateProjectLanguageAction(formData);
      setSavedOverride(next || null);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    });
  }

  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] inline-flex items-center gap-2">
            {t('label')}
            {isCustom ? (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-mono">
                {t('customBadge')}
              </span>
            ) : detectedLanguage ? (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--muted)]/15 text-[var(--muted)] font-mono">
                {t('detectedBadge')}
              </span>
            ) : null}
          </span>
          <p className="text-xs text-[var(--muted)] max-w-2xl leading-relaxed">
            {t('hint')}
          </p>
        </div>
        <Globe className="size-4 text-[var(--accent)] shrink-0" aria-hidden />
      </div>
      <form action={handleSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input
          type="hidden"
          name="languageCode"
          value={typeof selected === 'string' ? selected : ''}
        />
        <Autocomplete
          className="w-full max-w-sm"
          selectionMode="single"
          value={selected}
          onChange={(key: Key | Key[] | null) => setSelected(key as Key | null)}
          placeholder={t('placeholder')}
        >
          <Label className="sr-only">{t('label')}</Label>
          <Autocomplete.Trigger>
            <Autocomplete.Value />
            <Autocomplete.ClearButton />
            <Autocomplete.Indicator />
          </Autocomplete.Trigger>
          <Autocomplete.Popover>
            <Autocomplete.Filter filter={contains}>
              <SearchField autoFocus name="search" variant="secondary">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={t('searchPlaceholder')} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <ListBox renderEmptyState={() => <EmptyState>{t('empty')}</EmptyState>}>
                {LANGUAGES.map((l) => (
                  <ListBox.Item
                    key={l.code}
                    id={l.code}
                    textValue={`${l.code} ${l.name}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{l.name}</span>
                    <span className="text-xs font-mono text-[var(--muted)]">{l.code}</span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Autocomplete.Filter>
          </Autocomplete.Popover>
        </Autocomplete>
        <div className="flex items-center justify-end gap-3">
          {savedAt ? (
            <span className="text-xs text-[var(--success)] font-medium inline-flex items-center gap-1.5">
              <Check className="size-3.5" /> {t('saved')}
            </span>
          ) : null}
          <button
            type="submit"
            disabled={!dirty || isPending}
            className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {isPending ? <Spinner size="sm" /> : t('saveButton')}
          </button>
        </div>
      </form>
    </Card>
  );
}
