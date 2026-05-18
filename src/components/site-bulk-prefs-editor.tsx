'use client';

import { Card, Spinner } from '@heroui/react';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  BulkPrefsEditor,
  canonicalizePrefs,
  prefsKey,
  type BulkPrefs
} from '@/components/bulk-prefs-editor';

/**
 * Site-settings panel for the per-site bulk-generation prefs. Same
 * debounced PUT + lastSavedKey pattern as the bulk modal (no echo loop,
 * no last-write race). When the plan can't bulk it shows an upgrade
 * CTA instead of the editor.
 */
export function SiteBulkPrefsEditor({
  siteId,
  canBulk,
  initialPrefs,
  initialSiteOverride
}: {
  siteId: string;
  canBulk: boolean;
  initialPrefs: BulkPrefs;
  initialSiteOverride: boolean;
}) {
  const t = useTranslations('BulkGenerate');
  const [prefs, setPrefs] = useState<BulkPrefs>(() =>
    canonicalizePrefs(initialPrefs)
  );
  const lastSavedKey = useRef(prefsKey(canonicalizePrefs(initialPrefs)));
  const [saving, setSaving] = useState(false);
  const [siteOverride, setSiteOverride] = useState(initialSiteOverride);

  useEffect(() => {
    if (!canBulk) return;
    const key = prefsKey(prefs);
    if (key === lastSavedKey.current) return;
    const id = window.setTimeout(async () => {
      setSaving(true);
      try {
        const res = await fetch('/api/sites/bulk-generate', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            siteId,
            fields: prefs.fields,
            imageAngles: prefs.imageAngles
          })
        });
        if (res.ok) {
          lastSavedKey.current = key;
          setSiteOverride(true);
        }
      } catch {
        /* next toggle retriggers */
      } finally {
        setSaving(false);
      }
    }, 600);
    return () => window.clearTimeout(id);
  }, [prefs, siteId, canBulk]);

  const resetToAccountDefault = useCallback(async () => {
    // Instant revert, not an edit being persisted → no saving indicator.
    try {
      const res = await fetch('/api/sites/bulk-generate', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, reset: true })
      });
      if (res.ok) {
        const data = (await res.json()) as {
          prefs?: BulkPrefs;
          siteOverride?: boolean;
        };
        if (data.prefs) {
          const next = canonicalizePrefs(data.prefs);
          lastSavedKey.current = prefsKey(next);
          setPrefs(next);
        }
        setSiteOverride(data.siteOverride ?? false);
      }
    } catch {
      /* no-op */
    }
  }, [siteId]);

  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">{t('configTitle')}</h2>
          <p className="text-xs text-[var(--muted)]">{t('configSiteHint')}</p>
        </div>
        {canBulk ? (
          <div className="flex items-center gap-2 shrink-0">
            {saving ? (
              <Spinner className="size-3" aria-label={t('prefsSaving')} />
            ) : null}
            <button
              type="button"
              onClick={resetToAccountDefault}
              disabled={!siteOverride}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--accent)] underline underline-offset-2 disabled:opacity-40 disabled:no-underline disabled:cursor-default disabled:hover:text-[var(--muted)]"
            >
              {t('resetToAccountDefault')}
            </button>
          </div>
        ) : null}
      </div>

      {canBulk ? (
        <BulkPrefsEditor value={prefs} onChange={setPrefs} />
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4">
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {t('upgradeHint')}
          </p>
          <Link
            href="/pricing"
            className="px-3 py-1.5 rounded-md text-sm font-medium border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 inline-flex items-center gap-1.5"
          >
            {t('upgradeCta')}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}
    </Card>
  );
}
