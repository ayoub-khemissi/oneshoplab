'use client';

import { Card, Spinner } from '@heroui/react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BulkPrefsEditor,
  canonicalizePrefs,
  prefsKey,
  type BulkPrefs
} from '@/components/bulk-prefs-editor';
import { updateUserDefaultBulkPrefsAction } from '@/lib/bulk/prefs-actions';

/**
 * Account-wide DEFAULT bulk prefs editor (preferences page). Same
 * debounced + lastSavedKey persistence as the per-site editors, but
 * targets users.defaultBulkPrefs via a server action. Only rendered for
 * pro/scale (the page shows an upgrade CTA otherwise).
 */
export function AccountBulkPrefsForm({
  initialPrefs,
  initialHasDefault
}: {
  initialPrefs: BulkPrefs;
  initialHasDefault: boolean;
}) {
  const t = useTranslations('BulkGenerate');
  const [prefs, setPrefs] = useState<BulkPrefs>(() =>
    canonicalizePrefs(initialPrefs)
  );
  const lastSavedKey = useRef(prefsKey(canonicalizePrefs(initialPrefs)));
  const [saving, setSaving] = useState(false);
  const [hasDefault, setHasDefault] = useState(initialHasDefault);

  const save = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set('prefs', JSON.stringify(body));
      await updateUserDefaultBulkPrefsAction(fd);
    } catch {
      /* next change retriggers */
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    const key = prefsKey(prefs);
    if (key === lastSavedKey.current) return;
    const id = window.setTimeout(async () => {
      await save({ fields: prefs.fields, imageAngles: prefs.imageAngles });
      lastSavedKey.current = key;
      setHasDefault(true);
    }, 600);
    return () => window.clearTimeout(id);
  }, [prefs, save]);

  const resetToDefault = useCallback(async () => {
    // Instant revert, not an edit being persisted → no saving
    // indicator (call the action directly, bypassing save()).
    try {
      const fd = new FormData();
      fd.set('prefs', JSON.stringify({ reset: true }));
      await updateUserDefaultBulkPrefsAction(fd);
    } catch {
      /* no-op; user can retry */
    }
    const legacy = canonicalizePrefs({
      fields: { title: true, description: true, tags: true, images: true },
      imageAngles: ['lifestyle', 'studio', 'inuse']
    });
    lastSavedKey.current = prefsKey(legacy);
    setPrefs(legacy);
    setHasDefault(false);
  }, []);

  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">{t('configAccountTitle')}</h2>
          <p className="text-xs text-[var(--muted)]">
            {t('configAccountHint')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saving ? (
            <Spinner className="size-3" aria-label={t('prefsSaving')} />
          ) : null}
          <button
            type="button"
            onClick={resetToDefault}
            disabled={!hasDefault}
            className="text-[10px] text-[var(--muted)] hover:text-[var(--accent)] underline underline-offset-2 disabled:opacity-40 disabled:no-underline disabled:cursor-default disabled:hover:text-[var(--muted)]"
          >
            {t('resetToLegacyDefault')}
          </button>
        </div>
      </div>
      <BulkPrefsEditor value={prefs} onChange={setPrefs} />
    </Card>
  );
}
