'use client';

import {
  Autocomplete,
  EmptyState,
  Label,
  ListBox,
  SearchField,
  useFilter,
  type Key
} from '@heroui/react';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { flagEmoji, LANGUAGES } from '@/shared/i18n';
import { updateProjectLanguageAction } from '../api/actions';

export interface SiteLanguageButtonProps {
  projectId: string;
  /** Language in force right now: override, else platform-reported, else the
   *  audit's content guess. Null = nothing known, which is a red flag: every
   *  generation would fall back to English on a shop that may not speak it. */
  current: string | null;
}

/**
 * Compact language control for the site header: a flag + ISO code button that
 * opens the full picker. When nothing could be detected it turns into a red
 * warning, because picking the language is then the single most valuable
 * thing the merchant can do before generating anything.
 */
export function SiteLanguageButton({ projectId, current }: SiteLanguageButtonProps) {
  const t = useTranslations('SiteLanguage');
  const { contains } = useFilter({ sensitivity: 'base' });
  const [selected, setSelected] = useState<string | null>(current);
  const [isPending, startTransition] = useTransition();

  const flag = flagEmoji(selected);
  const known = Boolean(selected);

  function save(key: Key | null) {
    const code = typeof key === 'string' ? key : '';
    setSelected(code || null);
    const formData = new FormData();
    formData.set('projectId', projectId);
    formData.set('languageCode', code);
    startTransition(async () => {
      await updateProjectLanguageAction(formData);
    });
  }

  return (
    <Autocomplete
      selectionMode="single"
      selectedKey={selected}
      onSelectionChange={save}
      isDisabled={isPending}
    >
      <Label className="sr-only">{t('label')}</Label>
      <Autocomplete.Trigger
        data-testid="site-language-button"
        title={known ? t('buttonTitle') : t('unknownTitle')}
        className={[
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium',
          'transition-colors shrink-0',
          known
            ? 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)]'
            : 'border-red-500/50 text-red-500 hover:border-red-500'
        ].join(' ')}
      >
        {known ? (
          <>
            <span aria-hidden className="text-sm leading-none">
              {flag ?? '🌐'}
            </span>
            <span className="font-mono uppercase">{selected}</span>
          </>
        ) : (
          <>
            <TriangleAlert className="size-3.5" aria-hidden />
            <span>{t('unknownShort')}</span>
          </>
        )}
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
                <span>
                  {flagEmoji(l.code) ? `${flagEmoji(l.code)} ` : ''}
                  {l.name}
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
    </Autocomplete>
  );
}
