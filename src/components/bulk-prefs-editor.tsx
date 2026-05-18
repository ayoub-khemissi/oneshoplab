'use client';

import { Checkbox } from '@heroui/react';
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

  const fieldKeys: Array<{ key: BulkFieldKey; label: string }> = [
    { key: 'title', label: t('fieldTitle') },
    { key: 'description', label: t('fieldDescription') },
    { key: 'tags', label: t('fieldTags') },
    { key: 'images', label: t('fieldImages') }
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)] leading-relaxed">
        {t('configHint')}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {fieldKeys.map(({ key, label }) => (
          <Checkbox
            key={key}
            isSelected={value.fields[key]}
            isDisabled={disabled}
            onChange={(isSelected: boolean) =>
              onChange(
                canonicalizePrefs({
                  ...value,
                  fields: { ...value.fields, [key]: isSelected }
                })
              )
            }
            className="text-sm"
          >
            {label}
          </Checkbox>
        ))}
      </div>
      {value.fields.images ? (
        <div className="flex flex-col gap-2 border-l-2 border-[var(--border)] ml-1">
          <span className="text-[11px] font-medium text-[var(--muted)] pl-3">
            {t('imageTypesLabel')}
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-3">
            {ALL_ANGLES.map((angle) => {
              const checked = value.imageAngles.includes(angle);
              // Can't untick the last angle while Images is on (the
              // server would re-expand to all 3 anyway).
              const isLast = checked && value.imageAngles.length === 1;
              return (
                <Checkbox
                  key={angle}
                  isSelected={checked}
                  isDisabled={disabled || isLast}
                  onChange={(isSelected: boolean) =>
                    onChange(
                      canonicalizePrefs({
                        ...value,
                        imageAngles: isSelected
                          ? [...value.imageAngles, angle]
                          : value.imageAngles.filter((a) => a !== angle)
                      })
                    )
                  }
                  className="text-sm"
                >
                  {tAngle(`aiAngle.${angle}`)}
                </Checkbox>
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
