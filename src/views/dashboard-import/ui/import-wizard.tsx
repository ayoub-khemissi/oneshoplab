'use client';

import { ListBox, Select } from '@heroui/react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileUp,
  Loader2,
  RotateCcw
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  autoMap,
  detectDelimiter,
  IMPORT_FIELDS,
  IMPORT_LIMITS,
  mappingIsUsable,
  parseCsv,
  type ColumnMapping,
  type CsvDelimiterId,
  type ImportField,
  type ParsedCsv
} from '@/features/import-catalog/client';
import type { ImportPreview, ImportResult, PreviewRow } from '@/features/import-catalog';

type Step = 'file' | 'mapping' | 'preview' | 'done';
type DelimiterChoice = 'auto' | CsvDelimiterId;
const PAGE = 25;

/**
 * Four screens: the file, the columns, what will happen, what happened.
 * The browser parses the file to show headers and a first look; every
 * decision that writes goes through the server, which parses the same text
 * again and trusts only itself.
 */
export function ImportWizard({ siteId, exportHref }: { siteId: string; exportHref: string }) {
  const t = useTranslations('ImportCatalog');
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('file');
  const [csvText, setCsvText] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [choice, setChoice] = useState<DelimiterChoice>('auto');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const delimiter: CsvDelimiterId = useMemo(
    () => (choice === 'auto' ? detectDelimiter(csvText) : choice),
    [choice, csvText]
  );
  const parsed: ParsedCsv | null = useMemo(
    () => (csvText ? parseCsv(csvText, { delimiter }) : null),
    [csvText, delimiter]
  );

  async function onFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    setResult(null);
    if (!file) return;
    if (file.size > IMPORT_LIMITS.maxBytes) {
      setError(t('fileTooLarge', { max: Math.round(IMPORT_LIMITS.maxBytes / 1024 / 1024) }));
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsvText(text);
    const first = parseCsv(text);
    setChoice('auto');
    setMapping(autoMap(first.headers));
  }

  function onDelimiter(next: DelimiterChoice) {
    setChoice(next);
    const d = next === 'auto' ? detectDelimiter(csvText) : next;
    setMapping(autoMap(parseCsv(csvText, { delimiter: d }).headers));
  }

  function requestBody() {
    const m: Record<string, ImportField | null> = {};
    for (const [k, v] of Object.entries(mapping)) m[k] = v;
    return { csv: csvText, delimiter, mapping: m };
  }

  async function call<T>(path: 'preview' | 'commit'): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${siteId}/import/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody())
      });
      if (res.status === 429) {
        const body = (await res.json().catch(() => null)) as { retryAfterSec?: number } | null;
        setError(t('error_rate_limited', { seconds: body?.retryAfterSec ?? 60 }));
        return null;
      }
      if (res.status === 413) return (setError(t('error_too_large')), null);
      if (res.status === 404) return (setError(t('error_not_found')), null);
      if (res.status === 423) return (setError(t('error_locked')), null);
      if (!res.ok) return (setError(t('error_generic')), null);
      return (await res.json()) as T;
    } catch {
      setError(t('error_generic'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function goPreview() {
    const p = await call<ImportPreview>('preview');
    if (!p) return;
    setPreview(p);
    setPage(1);
    setStep('preview');
  }

  async function goCommit() {
    const r = await call<ImportResult>('commit');
    if (!r) return;
    setResult(r);
    setStep('done');
  }

  function reset() {
    setStep('file');
    setCsvText('');
    setFileName('');
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const fileIssues = parsed?.issues.filter((i) => i.row === undefined) ?? [];
  const blocked = parsed ? parsed.rows.length === 0 : true;

  return (
    <div className="flex flex-col gap-5 min-w-0">
      <Steps
        current={step}
        labels={[t('stepFile'), t('stepMapping'), t('stepPreview'), t('stepDone')]}
      />

      {error ? (
        <p
          role="alert"
          className="inline-flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}

      {step === 'file' ? (
        <section className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6">
          <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-10 text-center cursor-pointer hover:border-[var(--accent)] transition-colors">
            <FileUp className="size-8 text-[var(--accent)]" aria-hidden />
            <span className="text-sm font-medium">{fileName || t('dropLabel')}</span>
            <span className="text-xs text-[var(--muted)]">
              {t('dropHint', {
                max: Math.round(IMPORT_LIMITS.maxBytes / 1024 / 1024),
                rows: IMPORT_LIMITS.maxRows
              })}
            </span>
            <input
              ref={fileRef}
              data-testid="import-file"
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          <p className="text-xs text-[var(--muted)]">
            {t('templateHint')}{' '}
            <Link href={exportHref} className="underline hover:text-[var(--accent)]">
              {t('templateLink')}
            </Link>
          </p>

          {parsed ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[var(--muted)]">{t('delimiterLabel')}</span>
                <Select
                  aria-label={t('delimiterLabel')}
                  selectedKey={choice}
                  onSelectionChange={(k) =>
                    k == null ? undefined : onDelimiter(String(k) as DelimiterChoice)
                  }
                  className="min-w-0"
                >
                  <Select.Trigger data-testid="import-delimiter">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {(['auto', 'comma', 'semicolon', 'tab'] as DelimiterChoice[]).map((id) => (
                        <ListBox.Item key={id} id={id} textValue={t(`delimiter_${id}`)}>
                          {t(`delimiter_${id}`)}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <span className="text-xs text-[var(--muted)]" data-testid="import-detected">
                  {t('detected', { rows: parsed.rows.length, columns: parsed.headers.length })}
                </span>
              </div>
              {fileIssues.length > 0 ? (
                <ul className="flex flex-col gap-1 text-xs text-amber-600">
                  {fileIssues.map((i, idx) => (
                    <li key={idx} className="inline-flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5" aria-hidden />
                      {t(`issue_${i.code}`, { detail: i.detail ?? '' })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end">
            <PrimaryButton
              disabled={!parsed || blocked}
              onClick={() => setStep('mapping')}
              testId="import-next-mapping"
            >
              {t('next')} <ArrowRight className="size-4" aria-hidden />
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      {step === 'mapping' && parsed ? (
        <section className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6 min-w-0">
          <div>
            <h2 className="font-semibold">{t('mappingTitle')}</h2>
            <p className="text-sm text-[var(--muted)]">{t('mappingHint')}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {parsed.headers.map((h, i) => (
              <li
                key={i}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_14rem] gap-2 md:items-center rounded-md border border-[var(--border)] p-2.5"
              >
                <span className="text-sm font-medium truncate" title={h}>
                  {h || t('emptyHeader', { column: i + 1 })}
                </span>
                <span
                  className="text-xs text-[var(--muted)] truncate"
                  title={parsed.rows[0]?.[i] ?? ''}
                >
                  {parsed.rows[0]?.[i] || '—'}
                </span>
                <Select
                  aria-label={t('fieldHeader')}
                  selectedKey={mapping[i] ?? 'ignore'}
                  onSelectionChange={(k) =>
                    setMapping((m) => ({
                      ...m,
                      [i]: k == null || String(k) === 'ignore' ? null : (String(k) as ImportField)
                    }))
                  }
                  className="min-w-0"
                >
                  <Select.Trigger data-testid={`import-map-${i}`}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="ignore" textValue={t('ignoreField')}>
                        {t('ignoreField')}
                      </ListBox.Item>
                      {IMPORT_FIELDS.map((f) => (
                        <ListBox.Item key={f} id={f} textValue={t(`field_${f}`)}>
                          {t(`field_${f}`)}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </li>
            ))}
          </ul>
          {!mappingIsUsable(mapping) ? (
            <p className="text-xs text-amber-600 inline-flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" aria-hidden />
              {t('titleRequired')}
            </p>
          ) : null}
          <div className="flex justify-between gap-2">
            <GhostButton onClick={() => setStep('file')}>
              <ArrowLeft className="size-4" aria-hidden /> {t('previous')}
            </GhostButton>
            <PrimaryButton
              disabled={!mappingIsUsable(mapping) || busy}
              onClick={goPreview}
              testId="import-next-preview"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {t('next')} <ArrowRight className="size-4" aria-hidden />
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      {step === 'preview' && preview && parsed ? (
        <section className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6 min-w-0">
          <div>
            <h2 className="font-semibold">{t('previewTitle')}</h2>
            <p className="text-sm text-[var(--muted)]">{t('previewHint')}</p>
          </div>
          <Counts counts={preview.counts} overLimit={preview.overLimit} />
          <RowsTable
            rows={preview.rows}
            parsed={parsed}
            mapping={mapping}
            page={page}
            onPage={setPage}
          />
          <div className="flex justify-between gap-2 flex-wrap">
            <GhostButton onClick={() => setStep('mapping')}>
              <ArrowLeft className="size-4" aria-hidden /> {t('previous')}
            </GhostButton>
            <PrimaryButton
              disabled={busy || preview.counts.create + preview.counts.update === 0}
              onClick={goCommit}
              testId="import-commit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy
                ? t('committing')
                : t('commit', { count: preview.counts.create + preview.counts.update })}
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      {step === 'done' && result ? (
        <section
          className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6 min-w-0"
          data-testid="import-done"
        >
          <div className="inline-flex items-start gap-2">
            <CheckCircle2 className="size-5 text-[var(--success)] shrink-0 mt-0.5" aria-hidden />
            <div>
              <h2 className="font-semibold">{t('doneTitle')}</h2>
              <p className="text-sm text-[var(--muted)]">
                {t('doneBody', { create: result.counts.create, update: result.counts.update })}
                {result.imagesQueued > 0
                  ? ` ${t('imagesQueued', { count: result.imagesQueued })}`
                  : ''}
              </p>
            </div>
          </div>
          <Counts counts={result.counts} overLimit={result.overLimit} />
          {result.rows.length > 0 && parsed ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t('rejectedTitle')}</h3>
              <RowsTable
                rows={result.rows}
                parsed={parsed}
                mapping={mapping}
                page={page}
                onPage={setPage}
              />
            </div>
          ) : null}
          <div className="flex justify-between gap-2 flex-wrap">
            <GhostButton onClick={reset}>
              <RotateCcw className="size-4" aria-hidden /> {t('retry')}
            </GhostButton>
            <Link
              href={`/dashboard/sites/${siteId}?tab=products`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90"
            >
              {t('seeProducts')} <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Steps({ current, labels }: { current: Step; labels: string[] }) {
  const order: Step[] = ['file', 'mapping', 'preview', 'done'];
  const idx = order.indexOf(current);
  return (
    <ol
      className="flex items-center gap-2 text-xs text-[var(--muted)] flex-wrap"
      aria-label="steps"
    >
      {labels.map((label, i) => (
        <li
          key={label}
          className={`inline-flex items-center gap-1.5 ${i === idx ? 'text-[var(--foreground)] font-medium' : ''}`}
        >
          <span
            className={`inline-flex size-5 items-center justify-center rounded-full text-[10px] font-mono ${
              i <= idx
                ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                : 'border border-[var(--border)]'
            }`}
          >
            {i + 1}
          </span>
          {label}
          {i < labels.length - 1 ? (
            <span aria-hidden className="mx-1 opacity-50">
              ›
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Counts({ counts, overLimit }: { counts: ImportPreview['counts']; overLimit: number }) {
  const t = useTranslations('ImportCatalog');
  const chip = (key: keyof typeof counts, tone: string) => (
    <span
      key={key}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${tone}`}
      data-testid={`import-count-${key}`}
    >
      <span className="font-mono font-semibold">{counts[key]}</span> {t(`count_${key}`)}
    </span>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {chip('create', 'border-[var(--success)]/40 text-[var(--success)]')}
        {chip('update', 'border-[var(--accent)]/40 text-[var(--accent)]')}
        {chip('skip', 'border-[var(--border)] text-[var(--muted)]')}
        {chip('reject', 'border-red-500/40 text-red-600')}
      </div>
      {overLimit > 0 ? (
        <p className="text-xs text-amber-600 inline-flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" aria-hidden />
          {t('overLimit', { count: overLimit })}
        </p>
      ) : null}
    </div>
  );
}

function RowsTable({
  rows,
  parsed,
  mapping,
  page,
  onPage
}: {
  rows: PreviewRow[];
  parsed: ParsedCsv;
  mapping: ColumnMapping;
  page: number;
  onPage: (p: number) => void;
}) {
  const t = useTranslations('ImportCatalog');
  const titleCol = Number(Object.entries(mapping).find(([, f]) => f === 'title')?.[0] ?? -1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  const tone: Record<PreviewRow['action'], string> = {
    create: 'text-[var(--success)]',
    update: 'text-[var(--accent)]',
    skip: 'text-[var(--muted)]',
    reject: 'text-red-600'
  };
  const reasons = (r: PreviewRow) => [
    ...(r.reason && r.reason !== 'invalid' ? [t(`reason_${r.reason}`)] : []),
    ...r.errors.map((e) => t(`err_${e.code}`, { detail: e.detail ?? '' })),
    ...r.warnings.map((w) => t(`err_${w.code}`, { detail: w.detail ?? '' }))
  ];
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <ul className="flex flex-col gap-2" data-testid="import-rows">
        {slice.map((r) => (
          <li
            key={r.row}
            className="rounded-md border border-[var(--border)] p-2.5 flex flex-col gap-1 min-w-0"
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="text-sm truncate min-w-0">
                <span className="text-[var(--muted)] font-mono text-xs mr-2">
                  {t('rowLabel', { row: r.row })}
                </span>
                {titleCol >= 0 ? parsed.rows[r.row - 1]?.[titleCol] : ''}
              </span>
              <span className={`text-xs font-medium shrink-0 ${tone[r.action]}`}>
                {t(`action_${r.action}`)}
              </span>
            </div>
            {reasons(r).length > 0 ? (
              <p className="text-xs text-[var(--muted)]">{reasons(r).join(' · ')}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2 text-xs">
          <GhostButton onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1}>
            <ArrowLeft className="size-3.5" aria-hidden />
          </GhostButton>
          <span className="text-[var(--muted)]">{t('pageOf', { page, pages })}</span>
          <GhostButton onClick={() => onPage(Math.min(pages, page + 1))} disabled={page === pages}>
            <ArrowRight className="size-3.5" aria-hidden />
          </GhostButton>
        </div>
      ) : null}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  testId
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-[var(--border)] text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  );
}
