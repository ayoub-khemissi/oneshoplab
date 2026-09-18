'use client';

import { AlertTriangle, FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { autoMap, normalizeRow, parseCsv, IMPORT_LIMITS } from '@/features/import-catalog/client';
import { ManualProductForm, type ManualProductFormInitial } from '@/features/manual-catalog';

/**
 * The single-product flavour of the import: pick a CSV, its first valid row
 * fills the creation form, the merchant reviews and submits as usual. No new
 * write path — the form's own action does the saving, with its own checks.
 */
export function NewProductWithImport({ projectId }: { projectId: string }) {
  const t = useTranslations('ImportCatalog');
  const [initial, setInitial] = useState<ManualProductFormInitial>({ projectId });
  const [version, setVersion] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > IMPORT_LIMITS.maxBytes) {
      setNote({
        tone: 'warn',
        text: t('fileTooLarge', { max: Math.round(IMPORT_LIMITS.maxBytes / 1024 / 1024) })
      });
      return;
    }
    const parsed = parseCsv(await file.text());
    const mapping = autoMap(parsed.headers);
    const first = parsed.rows
      .map((cells, i) => normalizeRow(cells, mapping, i + 1, { requireImage: false }))
      .find((v) => v.input);
    if (!first?.input) {
      setNote({ tone: 'warn', text: t('prefillNothing') });
      return;
    }
    const p = first.input;
    setInitial({
      projectId,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      tags: p.tags,
      vendor: p.vendor,
      productType: p.productType,
      priceMin: p.priceMin,
      priceMax: p.priceMax,
      currency: p.currency,
      images: p.images.map((img) => ({ src: img.src, alt: img.alt, width: null, height: null }))
    });
    // Remount: the form reads `initial` as default values once.
    setVersion((v) => v + 1);
    setNote({
      tone: 'ok',
      text: t('prefillDone', { row: first.row, more: Math.max(0, parsed.rows.length - 1) })
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-dashed border-[var(--border)] px-3 py-2">
        <span className="text-xs text-[var(--muted)]">{t('prefillHint')}</span>
        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border)] text-xs font-medium cursor-pointer hover:border-[var(--accent)] transition-colors">
          <FileUp className="size-3.5" aria-hidden />
          {t('prefillButton')}
          <input
            ref={fileRef}
            data-testid="prefill-file"
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      </div>
      {note ? (
        <p
          data-testid="prefill-note"
          className={`text-xs inline-flex items-center gap-1.5 ${note.tone === 'ok' ? 'text-[var(--success)]' : 'text-amber-600'}`}
        >
          {note.tone === 'warn' ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
          {note.text}
        </p>
      ) : null}
      <ManualProductForm key={version} initial={initial} />
    </div>
  );
}
