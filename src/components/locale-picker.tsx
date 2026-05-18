'use client';

import { Label, ListBox, Select } from '@heroui/react';
import { useState } from 'react';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '@/i18n/routing';

/**
 * HeroUI Select wrapper for picking an ISO-639-1 locale. Mirrors the
 * selected key into a hidden `<input name>` so the server action
 * receives the value via the enclosing form — HeroUI's Select isn't
 * a native form control on its own.
 */
export function LocalePicker({
  name = 'language',
  defaultLocale,
  label,
  ariaLabel
}: {
  name?: string;
  defaultLocale: Locale;
  label?: string;
  ariaLabel?: string;
}) {
  const [value, setValue] = useState<Locale>(defaultLocale);
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <Label className="text-sm">{label}</Label> : null}
      <Select
        selectedKey={value}
        onSelectionChange={(k) => {
          if (!k) return;
          setValue(String(k) as Locale);
        }}
        aria-label={ariaLabel ?? label ?? 'Locale'}
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {SUPPORTED_LOCALES.map((loc) => (
              <ListBox.Item key={loc} id={loc} textValue={LOCALE_LABELS[loc]}>
                {LOCALE_LABELS[loc]}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
