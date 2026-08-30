'use client';

import { Spinner } from '@heroui/react';
import { Coins, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { CandidateRow } from './candidate-row';
import type { BulkCandidate } from '../model/types';
import { BulkPrefsEditor, type BulkPrefs } from '@/components/bulk-prefs-editor';
import { DebouncedSearchInput } from '@/components/debounced-search-input';
import { ModelPickerChips } from '@/features/model-preferences';
import {
  CHAT_MODEL_REGISTRY,
  IMAGE_MODEL_REGISTRY,
  type ChatModelId,
  type ImageQualityId
} from '@/entities/ai-model';

export interface SelectionModalProps {
  candidates: BulkCandidate[];
  balance: number;
  submitting: boolean;
  errorMsg: string | null;
  prefs: BulkPrefs;
  onChangePrefs: (next: BulkPrefs) => void;
  /** True while a prefs change is still being persisted/refreshed —
   *  blocks launch so a bulk can't start on stale candidates/cost. */
  launchBlocked: boolean;
  siteOverride: boolean;
  onResetPrefs: () => void;
  noFields: boolean;
  searchValue: string;
  onSearch: (q: string) => void;
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
  onPickChat: (id: ChatModelId) => void;
  onPickImage: (id: ImageQualityId) => void;
  /** Catalog-wide estimated total (full set, current config) shown on
   *  the step-1 preview. */
  estimateTotal: number;
  onCancel: () => void;
  onConfirm: (productIds: string[]) => Promise<boolean>;
}

// Selection modal — checkbox list + virtual budget counter
export function SelectionModal({
  candidates,
  balance,
  submitting,
  errorMsg,
  prefs,
  onChangePrefs,
  launchBlocked,
  siteOverride,
  onResetPrefs,
  noFields,
  searchValue,
  onSearch,
  chatModelId,
  imageQualityId,
  onPickChat,
  onPickImage,
  estimateTotal,
  onCancel,
  onConfirm
}: SelectionModalProps) {
  const t = useTranslations('BulkGenerate');
  const locale = useLocale();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // 2-step wizard: 1 = config (what + models), 2 = product selection.
  const [step, setStep] = useState<1 | 2>(1);

  // Selection is scoped to a FIXED config snapshot: clear it whenever
  // we're on step 1 (incl. after "Edit" from step 2), so step 2 always
  // selects against the current config / candidate set.
  useEffect(() => {
    if (step === 1) setSelected(new Set());
  }, [step]);

  // Reset the selection whenever the (debounced) search changes: the
  // candidate list is a server-filtered view, so a selection made
  // under a different query would have items not in `candidates` —
  // their cost wouldn't be in the budget bar / over-budget check
  // (the server still re-validates on submit, but the UI would lie).
  // Selection is therefore scoped to the current search view.
  useEffect(() => {
    setSelected(new Set());
  }, [searchValue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  const selectedCost = useMemo(() => {
    let sum = 0;
    for (const c of candidates) {
      if (selected.has(c.id)) sum += c.pendingCost;
    }
    return sum;
  }, [candidates, selected]);
  const remaining = balance - selectedCost;
  const overBudget = remaining < 0;

  function toggle(id: string, cost: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Defensive: shouldn't be reachable since the row is disabled
        // when over-budget, but enforce here too.
        if (cost > balance - selectedCost) return prev;
        next.add(id);
      }
      return next;
    });
  }

  /**
   * Greedy top-down fill — walk the list in display order, check while
   * we can fit, stop and leave the rest disabled when the next product
   * doesn't fit. Matches the user's mental model: "select all jusqu'à
   * ce qu'il y ait plus assez de crédit, les produits suivants ne
   * seront donc pas sélectionnés."
   */
  function selectAllWithinBudget() {
    const next = new Set<string>();
    let used = 0;
    for (const c of candidates) {
      if (used + c.pendingCost > balance) break;
      next.add(c.id);
      used += c.pendingCost;
    }
    setSelected(next);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleConfirm() {
    if (selected.size === 0 || overBudget || noFields || launchBlocked) return;
    await onConfirm(Array.from(selected));
  }

  const allSelected = selected.size === candidates.length && candidates.length > 0;
  const noneSelected = selected.size === 0;
  const budgetPct = balance > 0 ? Math.min(100, Math.round((selectedCost / balance) * 100)) : 0;

  const activeFieldLabels = (['title', 'description', 'tags', 'images'] as const)
    .filter((f) => prefs.fields[f])
    .map((f) =>
      f === 'title'
        ? t('fieldTitle')
        : f === 'description'
          ? t('fieldDescription')
          : f === 'tags'
            ? t('fieldTags')
            : t('fieldImages')
    );
  const chatName = CHAT_MODEL_REGISTRY[chatModelId]?.displayName ?? chatModelId;
  const imgName = IMAGE_MODEL_REGISTRY[imageQualityId]?.displayName ?? imageQualityId;
  const recap = [...activeFieldLabels, chatName, imgName].join(' · ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] sm:max-h-[85vh] flex flex-col"
      >
        {/* Header + stepper ---------------------------------------- */}
        <div className="p-4 sm:p-5 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-base font-semibold shrink-0">{t('selectionTitle')}</h3>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] truncate">
              · {step}/2 · {step === 1 ? t('stepConfig') : t('stepSelect')}
            </span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('cancel')}
            className="size-8 rounded-md hover:bg-[var(--default)] inline-flex items-center justify-center shrink-0"
          >
            <X className="size-4" />
          </button>
        </div>

        {step === 1 ? (
          /* ===== Step 1 — Configuration ===== */
          <div className="overflow-y-auto flex-1 p-4 sm:p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--default)]/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {t('configTitle')}
                </span>
                <button
                  type="button"
                  onClick={onResetPrefs}
                  disabled={!siteOverride}
                  className="text-[10px] text-[var(--muted)] hover:text-[var(--accent)] underline underline-offset-2 disabled:opacity-40 disabled:no-underline disabled:cursor-default disabled:hover:text-[var(--muted)] shrink-0"
                >
                  {t('resetToAccountDefault')}
                </button>
              </div>
              <BulkPrefsEditor value={prefs} onChange={onChangePrefs} />
            </div>

            <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--default)]/20 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {t('modelsTitle')}
              </span>
              <ModelPickerChips
                chatModelId={chatModelId}
                imageQualityId={imageQualityId}
                onPickChat={onPickChat}
                onPickImage={onPickImage}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)] px-1">
              <span>{t('eligibleCount', { count: candidates.length })}</span>
              <span className="font-mono tabular-nums inline-flex items-center gap-1">
                <Coins className="size-3" aria-hidden />
                {t('estimatedTotal', {
                  cost: estimateTotal.toLocaleString(locale)
                })}
              </span>
            </div>
          </div>
        ) : (
          /* ===== Step 2 — Product selection ===== */
          <>
            <div className="p-4 sm:p-5 border-b border-[var(--border)] flex flex-col gap-3">
              {/* Config recap (read-only) + edit back to step 1 */}
              <div className="flex items-center justify-between gap-3 rounded-md bg-[var(--default)]/30 px-3 py-2">
                <span className="text-[11px] text-[var(--muted)] truncate min-w-0">{recap}</span>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-[10px] font-medium text-[var(--accent)] hover:underline shrink-0"
                >
                  {t('editConfig')}
                </button>
              </div>

              {/* Budget bar */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--muted)]">{t('budgetLabel')}</span>
                  <span className="font-mono tabular-nums inline-flex items-center gap-1">
                    <Coins className="size-3" aria-hidden />
                    <span className={overBudget ? 'text-[var(--danger)]' : ''}>
                      {selectedCost.toLocaleString(locale)}
                    </span>
                    <span className="text-[var(--muted)]">/ {balance.toLocaleString(locale)}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--default)] overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      overBudget
                        ? 'bg-[var(--danger)]'
                        : budgetPct >= 90
                          ? 'bg-[var(--warning)]'
                          : 'bg-[var(--accent)]'
                    }`}
                    style={{ width: `${budgetPct}%` }}
                  />
                </div>
              </div>

              <DebouncedSearchInput
                value={searchValue}
                onDebouncedChange={onSearch}
                placeholder={t('searchPlaceholder')}
                ariaLabel={t('searchPlaceholder')}
              />

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs font-mono uppercase tracking-wider text-[var(--muted)]">
                  {t('selectionCount', {
                    selected: selected.size,
                    total: candidates.length
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllWithinBudget}
                    disabled={candidates.length === 0 || allSelected}
                    className="px-2.5 py-1 rounded text-xs font-medium border border-[var(--border)] hover:border-[var(--accent)] disabled:opacity-50"
                  >
                    {t('selectAllWithinBudget')}
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={noneSelected}
                    className="px-2.5 py-1 rounded text-xs font-medium border border-[var(--border)] hover:border-[var(--accent)] disabled:opacity-50"
                  >
                    {t('clearSelection')}
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-[var(--border)]">
              {candidates.length === 0 ? (
                <div className="p-5 text-sm text-[var(--muted)] text-center">
                  {t('selectionEmpty')}
                </div>
              ) : (
                candidates.map((c) => {
                  const isSelected = selected.has(c.id);
                  const fits = c.pendingCost <= remaining;
                  const enabled = isSelected || fits;
                  return (
                    <CandidateRow
                      key={c.id}
                      candidate={c}
                      selected={isSelected}
                      enabled={enabled}
                      onToggle={() => toggle(c.id, c.pendingCost)}
                    />
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Footer — step-specific. Buttons full-width on mobile. */}
        <div className="p-4 sm:p-5 border-t border-[var(--border)] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-col gap-0.5 text-xs">
            {step === 2 ? (
              <span className="text-[var(--muted)]">
                {t.rich('summarySelected', {
                  count: selected.size,
                  cost: selectedCost,
                  coins: () => (
                    <Coins className="size-3 inline-block align-text-bottom" aria-hidden />
                  )
                })}
              </span>
            ) : null}
            {errorMsg ? <span className="text-[var(--danger)]">{errorMsg}</span> : null}
          </div>
          <div className="flex items-center gap-2 sm:shrink-0">
            {step === 1 ? (
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 sm:flex-none px-3 py-2 rounded-md text-sm hover:bg-[var(--default)]"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={noFields || launchBlocked || candidates.length === 0}
                  title={
                    noFields
                      ? t('errorNoFields')
                      : candidates.length === 0
                        ? t('selectionEmpty')
                        : undefined
                  }
                  className="flex-1 sm:flex-none px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
                >
                  {t('next')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 sm:flex-none px-3 py-2 rounded-md text-sm hover:bg-[var(--default)]"
                >
                  {t('back')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={
                    submitting || selected.size === 0 || overBudget || noFields || launchBlocked
                  }
                  title={noFields ? t('errorNoFields') : undefined}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {submitting ? <Spinner size="sm" /> : null}
                  {t('confirmSelection', {
                    count: selected.size,
                    cost: selectedCost
                  })}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
