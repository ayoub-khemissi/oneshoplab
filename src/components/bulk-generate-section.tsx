'use client';

import { Spinner } from '@heroui/react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';

// ---------------------------------------------------------------------
// Shared types (mirror the server module)
// ---------------------------------------------------------------------

interface ActiveBulkJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
  total: number;
  processed: number;
  errors: number;
}

type FieldKey = 'title' | 'description' | 'tags' | 'images';
type FieldOutcome = 'done' | { error: string };

interface ProductBulkState {
  fields: Partial<Record<FieldKey, FieldOutcome>>;
}

interface BulkJobStatusForUi {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
  error: string | null;
  total: number;
  fullySucceeded: number;
  partiallySucceeded: number;
  fullyFailed: number;
  notYetAttempted: number;
  perProduct: Record<string, ProductBulkState>;
}

interface CostBreakdown {
  productCount: number;
  perProduct: { chat: number; images: number; total: number };
  total: number;
  chatModelId: string;
  imageQualityId: string;
}

interface BulkCandidate {
  id: string;
  title: string;
  sourceId: string;
  pendingFields: FieldKey[];
  pendingCost: number;
}

interface BulkGenerateSectionProps {
  siteId: string;
  plan: string;
  /** Total active products on the site — informs the upgrade hint copy. */
  productCount: number;
  /** Sum of pendingCost across candidates, computed server-side at the
   *  user's current preferences. Drives the cost label on the entry CTA. */
  costEstimate: number;
  /** Per-product candidate list. Products fully generated are excluded
   *  by the server. The selection modal renders one row per entry. */
  initialCandidates: BulkCandidate[];
  initialActive: ActiveBulkJob | null;
  initialDetail: BulkJobStatusForUi | null;
  creditsBalance: number;
  productTitleById: Record<string, string>;
}

export function BulkGenerateSection({
  siteId,
  plan,
  productCount,
  costEstimate,
  initialCandidates,
  initialActive,
  initialDetail,
  creditsBalance,
  productTitleById
}: BulkGenerateSectionProps) {
  const t = useTranslations('BulkGenerate');
  // Bulk catalog generation is unlocked from the Pro plan upwards. Free
  // and Starter see the upgrade hint instead of the CTA.
  const canBulk = plan === 'pro' || plan === 'scale';
  const [active, setActive] = useState<ActiveBulkJob | null>(initialActive);
  const [detail, setDetail] = useState<BulkJobStatusForUi | null>(initialDetail);
  const [candidates, setCandidates] = useState<BulkCandidate[]>(initialCandidates);
  const [estimate, setEstimate] = useState<{ total: number; breakdown: CostBreakdown | null }>(
    { total: costEstimate, breakdown: null }
  );
  const [balance, setBalance] = useState<number>(creditsBalance);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sites/bulk-generate?siteId=${encodeURIComponent(siteId)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        active: ActiveBulkJob | null;
        detail: BulkJobStatusForUi | null;
        estimate: CostBreakdown;
        candidates: BulkCandidate[];
        creditsBalance: number;
      };
      setActive(data.active);
      setDetail(data.detail);
      setCandidates(data.candidates);
      setEstimate({ total: data.estimate.total, breakdown: data.estimate });
      setBalance(data.creditsBalance);
    } catch {
      /* next tick will retry */
    }
  }, [siteId]);

  useEffect(() => {
    if (!active || active.status === 'completed' || active.status === 'failed') {
      return;
    }
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      refresh();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, refresh]);

  useEffect(() => {
    if (modalOpen) refresh();
  }, [modalOpen, refresh]);

  async function startBulk(productIds: string[]) {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/sites/bulk-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, productIds })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(t(errorKey(body.error)));
        return false;
      }
      setModalOpen(false);
      await refresh();
      return true;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelBulk() {
    if (!active || cancelling) return;
    setCancelling(true);
    try {
      await fetch(
        `/api/sites/bulk-generate?siteId=${encodeURIComponent(
          siteId
        )}&jobId=${encodeURIComponent(active.id)}`,
        { method: 'DELETE' }
      );
      await refresh();
    } finally {
      setCancelling(false);
    }
  }

  async function retryFailed() {
    if (!detail || retrying) return;
    setRetrying(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/sites/bulk-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, retryFromBulkId: detail.id })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(t(errorKey(body.error)));
        return;
      }
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  // ---------------------------------------------------------------------
  // Active progress banner
  // ---------------------------------------------------------------------
  if (active) {
    const progress =
      active.total > 0
        ? Math.min(100, Math.round((active.processed / active.total) * 100))
        : 0;
    return (
      <div className="flex items-start gap-3 p-4 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/5">
        <Layers className="size-5 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[var(--foreground)]">
              {t('bannerInProgress')}
            </span>
            <span className="text-xs font-mono uppercase tracking-wider text-[var(--accent)]">
              {active.processed}/{active.total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--default)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            {t('bannerHint')}
            {active.errors > 0 ? (
              <span className="ml-2 text-[var(--danger)]">
                · {t('bannerErrors', { count: active.errors })}
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={cancelBulk}
          disabled={cancelling}
          className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--border)] text-[var(--muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] disabled:opacity-50"
        >
          {cancelling ? t('cancellingShort') : t('cancelBulk')}
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Post-completion summary banner
  // ---------------------------------------------------------------------
  if (detail && detail.status !== 'pending' && detail.status !== 'running') {
    const cancelled = detail.error === 'cancelled_by_user';
    const insufficient = detail.error === 'insufficient_credits';
    const stalled = detail.error === 'bulk_stalled';
    const someErrors = detail.partiallySucceeded + detail.fullyFailed > 0;
    const tone = cancelled
      ? 'muted'
      : detail.fullyFailed === detail.total && detail.total > 0
        ? 'danger'
        : someErrors || stalled || insufficient
          ? 'warning'
          : 'success';
    const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
    const cls = {
      success: 'border-[var(--success)]/40 bg-[var(--success)]/5 text-[var(--success)]',
      warning: 'border-[var(--warning)]/40 bg-[var(--warning)]/5 text-[var(--warning)]',
      danger: 'border-[var(--danger)]/40 bg-[var(--danger)]/5 text-[var(--danger)]',
      muted: 'border-[var(--border)] bg-[var(--default)]/40 text-[var(--muted)]'
    }[tone];

    const hasFailures = detail.partiallySucceeded + detail.fullyFailed > 0;

    return (
      <>
        <div className={`flex flex-col gap-3 p-4 rounded-md border ${cls}`}>
          <div className="flex items-start gap-3">
            <Icon className="size-5 mt-0.5 shrink-0" aria-hidden />
            <div className="flex-1 flex flex-col gap-1">
              <span className="font-semibold text-[var(--foreground)]">
                {cancelled
                  ? t('summaryCancelled')
                  : insufficient
                    ? t('summaryInsufficientCredits')
                    : stalled
                      ? t('summaryStalled')
                      : detail.fullyFailed === detail.total && detail.total > 0
                        ? t('summaryAllFailed')
                        : detail.fullyFailed + detail.partiallySucceeded === 0
                          ? t('summaryAllSucceeded')
                          : t('summaryMixed')}
              </span>
              <span className="text-xs text-[var(--muted)] leading-relaxed">
                {t('summaryStats', {
                  ok: detail.fullySucceeded,
                  partial: detail.partiallySucceeded,
                  failed: detail.fullyFailed,
                  total: detail.total
                })}
              </span>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {canBulk && hasFailures ? (
                <button
                  type="button"
                  onClick={retryFailed}
                  disabled={retrying}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {retrying ? <Spinner size="sm" /> : <RotateCcw className="size-3.5" />}
                  {t('retryFailed')}
                </button>
              ) : null}
              {canBulk && candidates.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90"
                >
                  {t('relaunch')}
                </button>
              ) : null}
            </div>
          </div>

          {hasFailures ? (
            <button
              type="button"
              onClick={() => setDetailExpanded((v) => !v)}
              className="self-start text-xs font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
            >
              {detailExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              {detailExpanded ? t('hideErrors') : t('showErrors')}
            </button>
          ) : null}

          {detailExpanded ? (
            <FailureBreakdown
              perProduct={detail.perProduct}
              productTitleById={productTitleById}
            />
          ) : null}

          {errorMsg ? (
            <p className="text-xs text-[var(--danger)]">{errorMsg}</p>
          ) : null}
        </div>

        {modalOpen ? (
          <SelectionModal
            candidates={candidates}
            balance={balance}
            submitting={submitting}
            errorMsg={errorMsg}
            onCancel={() => setModalOpen(false)}
            onConfirm={(ids) => startBulk(ids)}
          />
        ) : null}
      </>
    );
  }

  // ---------------------------------------------------------------------
  // No active + no recent detail → CTA card
  // ---------------------------------------------------------------------
  const noProducts = productCount === 0;
  const noCandidates = candidates.length === 0;

  return (
    <>
      <div className="flex items-start gap-3 p-4 rounded-md border border-[var(--border)] bg-[var(--default)]/30">
        <Sparkles className="size-5 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
        <div className="flex-1 flex flex-col gap-1">
          <span className="font-semibold text-[var(--foreground)]">{t('title')}</span>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            {!canBulk
              ? t('upgradeHint')
              : noCandidates
                ? t('subtitleNoCandidates')
                : t('subtitle', { count: candidates.length })}
          </p>
        </div>
        {canBulk ? (
          <button
            type="button"
            disabled={noProducts || noCandidates}
            onClick={() => setModalOpen(true)}
            className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              noProducts
                ? t('errorNoProducts')
                : noCandidates
                  ? t('subtitleNoCandidates')
                  : undefined
            }
          >
            {t('cta')}
          </button>
        ) : (
          <Link
            href="/pricing"
            className="px-3 py-2 rounded-md text-sm font-medium border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            {t('upgradeCta')}
          </Link>
        )}
      </div>

      {modalOpen ? (
        <SelectionModal
          candidates={candidates}
          balance={balance}
          submitting={submitting}
          errorMsg={errorMsg}
          onCancel={() => setModalOpen(false)}
          onConfirm={(ids) => startBulk(ids)}
        />
      ) : null}

      {/* surface "fresh start, no bulk yet" cost estimate too */}
      {!noCandidates && estimate.breakdown ? (
        <p className="text-xs text-[var(--muted)] -mt-2 ml-1">
          {t('hintFullCost', {
            count: candidates.length,
            cost: estimate.total
          })}
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------
// Selection modal — checkbox list + virtual budget counter
// ---------------------------------------------------------------------

function SelectionModal({
  candidates,
  balance,
  submitting,
  errorMsg,
  onCancel,
  onConfirm
}: {
  candidates: BulkCandidate[];
  balance: number;
  submitting: boolean;
  errorMsg: string | null;
  onCancel: () => void;
  onConfirm: (productIds: string[]) => Promise<boolean>;
}) {
  const t = useTranslations('BulkGenerate');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

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
    if (selected.size === 0 || overBudget) return;
    await onConfirm(Array.from(selected));
  }

  const allSelected = selected.size === candidates.length && candidates.length > 0;
  const noneSelected = selected.size === 0;
  const budgetPct =
    balance > 0 ? Math.min(100, Math.round((selectedCost / balance) * 100)) : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col"
      >
        {/* Header --------------------------------------------------- */}
        <div className="p-5 border-b border-[var(--border)] flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold">{t('selectionTitle')}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                {t('selectionBody')}
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label={t('cancel')}
              className="size-8 rounded-md hover:bg-[var(--default)] inline-flex items-center justify-center"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Virtual budget bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">{t('budgetLabel')}</span>
              <span className="font-mono tabular-nums">
                <span className={overBudget ? 'text-[var(--danger)]' : ''}>
                  {selectedCost.toLocaleString()}
                </span>
                <span className="text-[var(--muted)]"> / {balance.toLocaleString()} cr.</span>
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

          {/* Toolbar */}
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

        {/* Product list ------------------------------------------- */}
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

        {/* Footer ------------------------------------------------ */}
        <div className="p-5 border-t border-[var(--border)] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="text-[var(--muted)]">
              {t('summarySelected', {
                count: selected.size,
                cost: selectedCost
              })}
            </span>
            {errorMsg ? (
              <span className="text-[var(--danger)]">{errorMsg}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2 rounded-md text-sm hover:bg-[var(--default)]"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || selected.size === 0 || overBudget}
              className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting ? <Spinner size="sm" /> : null}
              {t('confirmSelection', {
                count: selected.size,
                cost: selectedCost
              })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  selected,
  enabled,
  onToggle
}: {
  candidate: BulkCandidate;
  selected: boolean;
  enabled: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('BulkGenerate');
  const fieldLabel: Record<FieldKey, string> = {
    title: t('fieldTitle'),
    description: t('fieldDescription'),
    tags: t('fieldTags'),
    images: t('fieldImages')
  };
  return (
    <label
      className={`flex items-center gap-3 px-5 py-3 hover:bg-[var(--default)]/40 ${
        enabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
      } ${selected ? 'bg-[var(--accent)]/5' : ''}`}
      title={!enabled ? t('rowDisabledHint') : undefined}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={!enabled}
        onChange={onToggle}
        className="size-4 accent-[var(--accent)] cursor-pointer disabled:cursor-not-allowed"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-medium text-[var(--foreground)] truncate">
          {candidate.title}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {candidate.pendingFields.map((f) => (
            <span
              key={f}
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--default)] text-[var(--muted)] font-mono"
            >
              {fieldLabel[f]}
            </span>
          ))}
        </div>
      </div>
      <span className="text-xs font-mono tabular-nums text-[var(--muted)] shrink-0">
        {candidate.pendingCost.toLocaleString()} cr.
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------
// Failure breakdown (atomic UI for the post-completion banner)
// ---------------------------------------------------------------------

function FailureBreakdown({
  perProduct,
  productTitleById
}: {
  perProduct: Record<string, ProductBulkState>;
  productTitleById: Record<string, string>;
}) {
  const t = useTranslations('BulkGenerate');
  const fieldLabel: Record<FieldKey, string> = {
    title: t('fieldTitle'),
    description: t('fieldDescription'),
    tags: t('fieldTags'),
    images: t('fieldImages')
  };

  const rows = Object.entries(perProduct).filter(([, state]) =>
    Object.values(state.fields).some((v) => v && v !== 'done')
  );
  if (rows.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] pt-3 flex flex-col gap-2 text-xs max-h-72 overflow-y-auto">
      {rows.map(([productId, state]) => (
        <div key={productId} className="flex flex-col gap-1">
          <span className="font-medium text-[var(--foreground)]">
            {productTitleById[productId] ?? productId}
          </span>
          <ul className="flex flex-col gap-1 pl-3">
            {(['title', 'description', 'tags', 'images'] as const).map((f) => {
              const outcome = state.fields[f];
              if (!outcome) return null;
              if (outcome === 'done') {
                return (
                  <li
                    key={f}
                    className="text-[var(--success)] inline-flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="size-3" /> {fieldLabel[f]}
                  </li>
                );
              }
              return (
                <li
                  key={f}
                  className="text-[var(--danger)] inline-flex items-start gap-1.5"
                >
                  <X className="size-3 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-medium">{fieldLabel[f]}</span>
                    <span className="text-[var(--muted)]"> · {outcome.error}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function errorKey(code: string | undefined): string {
  switch (code) {
    case 'plan_not_eligible':
      return 'errorPlanNotEligible';
    case 'bulk_already_running':
    case 'already_running':
      return 'errorAlreadyRunning';
    case 'no_products':
      return 'errorNoProducts';
    case 'insufficient_credits':
      return 'errorInsufficientCredits';
    case 'invalid_selection':
      return 'errorInvalidSelection';
    case 'source_not_found':
      return 'errorSourceNotFound';
    case 'no_failures':
      return 'errorNoFailures';
    default:
      return 'errorGeneric';
  }
}
