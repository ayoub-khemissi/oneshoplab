'use client';

import { Checkbox, Label } from '@heroui/react';
import { useId } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Shared bulk-generation prefs model + a pure controlled editor.
 * Persistence is the caller's job — this component only renders the
 * checkboxes and reports a canonicalized value via onChange. Reused by
 * the bulk modal, the site-settings tab and the account-prefs page.
 */

export type BulkFieldKey = 'title' | 'description' | 'tags' | 'images';
export type ImageAngle = 'lifestyle' | 'studio' | 'inuse';
export const ALL_ANGLES: ImageAngle[] = ['lifestyle', 'studio', 'inuse'];

export interface BulkPrefs {
  fields: Record<BulkFieldKey, boolean>;
  imageAngles: ImageAngle[];
}

/** Mirror of the server's resolveBulkPrefs: stable field order, angles
 *  filtered to canonical order, images-on + 0 angles → all 3. Keeping
 *  the client shape identical to what the server persists makes the
 *  saved-state key stable (no echo loop, no last-write race). */
export function canonicalizePrefs(p: BulkPrefs): BulkPrefs {
  const fields: Record<BulkFieldKey, boolean> = {
    title: p.fields.title !== false,
    description: p.fields.description !== false,
    tags: p.fields.tags !== false,
    images: p.fields.images !== false
  };
  let imageAngles = ALL_ANGLES.filter((a) => p.imageAngles.includes(a));
  if (fields.images && imageAngles.length === 0) {
    imageAngles = [...ALL_ANGLES];
  }
  return { fields, imageAngles };
}

export const prefsKey = (p: BulkPrefs): string =>
  JSON.stringify({ fields: p.fields, imageAngles: p.imageAngles });

export const noFieldsSelected = (p: BulkPrefs): boolean =>
  !p.fields.title &&
  !p.fields.description &&
  !p.fields.tags &&
  !p.fields.images;

const FIELD_KEYS: BulkFieldKey[] = ['title', 'description', 'tags', 'images'];

/** HeroUI v3 Checkbox is a compound component — without Control /
 *  Indicator / Content it renders only the label (no visible box, no
 *  state). This wrapper composes it correctly once. */
function PrefCheckbox({
  id,
  label,
  selected,
  disabled,
  onToggle
}: {
  id: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Checkbox
      id={id}
      isSelected={selected}
      isDisabled={disabled}
      onChange={onToggle}
    >
      <Checkbox.Control>
        <Checkbox.Indicator />
      </Checkbox.Control>
      <Checkbox.Content>
        <Label htmlFor={id}>{label}</Label>
      </Checkbox.Content>
    </Checkbox>
  );
}

export function BulkPrefsEditor({
  value,
  onChange,
  disabled = false
}: {
  value: BulkPrefs;
  onChange: (next: BulkPrefs) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('BulkGenerate');
  // Image-angle labels are already translated under Report.aiAngle.
  const tAngle = useTranslations('Report');
  const uid = useId();

  const fieldLabels: Record<BulkFieldKey, string> = {
    title: t('fieldTitle'),
    description: t('fieldDescription'),
    tags: t('fieldTags'),
    images: t('fieldImages')
  };
  const selectedFieldCount = FIELD_KEYS.filter((k) => value.fields[k]).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)] leading-relaxed">
        {t('configHint')}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {FIELD_KEYS.map((key) => {
          // Never let the last selected field be unticked — at least
          // one element must always be generated.
          const isOnlySelected =
            value.fields[key] && selectedFieldCount === 1;
          return (
            <PrefCheckbox
              key={key}
              id={`${uid}-f-${key}`}
              label={fieldLabels[key]}
              selected={value.fields[key]}
              disabled={disabled || isOnlySelected}
              onToggle={(next) =>
                onChange(
                  canonicalizePrefs({
                    ...value,
                    fields: { ...value.fields, [key]: next }
                  })
                )
              }
            />
          );
        })}
      </div>
      {value.fields.images ? (
        <div className="flex flex-col gap-2 border-l-2 border-[var(--border)] ml-1">
          <span className="text-[11px] font-medium text-[var(--muted)] pl-3">
            {t('imageTypesLabel')}
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-3">
            {ALL_ANGLES.map((angle) => {
              const checked = value.imageAngles.includes(angle);
              // Can't untick the last angle while Images is on.
              const isLast = checked && value.imageAngles.length === 1;
              return (
                <PrefCheckbox
                  key={angle}
                  id={`${uid}-a-${angle}`}
                  label={tAngle(`aiAngle.${angle}`)}
                  selected={checked}
                  disabled={disabled || isLast}
                  onToggle={(next) =>
                    onChange(
                      canonicalizePrefs({
                        ...value,
                        imageAngles: next
                          ? [...value.imageAngles, angle]
                          : value.imageAngles.filter((a) => a !== angle)
                      })
                    )
                  }
                />
              );
            })}
          </div>
        </div>
      ) : null}
      {noFieldsSelected(value) ? (
        <p className="text-xs text-[var(--danger)]">{t('errorNoFields')}</p>
      ) : null}
    </div>
  );
}
