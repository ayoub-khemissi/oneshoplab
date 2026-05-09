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
  /** Latest audit-detected language. Surfaced as a "detected: …" badge
   *  next to the picker when no override is set. */
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

  // The dropdown only reflects what's actually persisted as an override.
  // Pre-filling with the audit-detected language led to a confusing UX
  // where the user saw a value selected they hadn't saved, and clicking
  // the clear button looked like it was bouncing. The auto-detect state
  // is conveyed by the "detected: …" badge instead.
  const [selected, setSelected] = useState<Key | null>(initialOverride);
  const [savedOverride, setSavedOverride] = useState<string | null>(initialOverride);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = (selected ?? null) !== (savedOverride ?? null);
  const isCustom = savedOverride !== null;

  function handleSave() {
    if (!dirty || isPending) return;
    const next = typeof selected === 'string' ? selected : '';
    const formData = new FormData();
    formData.set('projectId', projectId);
    formData.set('languageCode', next);
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
      {/* No native <form> here on purpose: HeroUI's Autocomplete renders
          internal buttons (trigger, ClearButton, indicator) without an
          explicit `type` attribute, so they default to `type="submit"`
          when nested in a form. Clicking the X used to instantly submit
          the form *and* update React state in the same tick, which both
          auto-saved (without the user pressing Save) and re-rendered with
          stale DOM values. Driving the save from a plain button click
          sidesteps the whole class of bugs. */}
      <div className="flex flex-col gap-3">
        <Autocomplete
          className="w-full max-w-sm"
          selectionMode="single"
          // HeroUI's Autocomplete wraps react-aria's Select — the controlled
          // props are selectedKey / onSelectionChange, not value / onChange.
          // Using the wrong pair leaves the component uncontrolled, so the
          // ClearButton bounces back to the previous value.
          selectedKey={selected}
          onSelectionChange={(key: Key | null) => setSelected(key)}
          onClear={() => setSelected(null)}
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
              <SearchField autoFocus variant="secondary">
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
                    textValue={`${l.name} ${l.promptName} ${l.code}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{l.name}</span>
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
            type="button"
            onClick={handleSave}
            disabled={!dirty || isPending}
            className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {isPending ? <Spinner size="sm" /> : t('saveButton')}
          </button>
        </div>
      </div>
    </Card>
  );
}
