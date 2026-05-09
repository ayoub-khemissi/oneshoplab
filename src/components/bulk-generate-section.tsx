'use client';

import { Spinner } from '@heroui/react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  Sparkles,
  X
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';

interface ActiveBulkJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
  total: number;
  processed: number;
  errors: number;
}

type FieldOutcome = 'done' | { error: string };

interface ProductBulkState {
  fields: Partial<Record<'title' | 'description' | 'tags' | 'images', FieldOutcome>>;
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

interface BulkGenerateSectionProps {
  siteId: string;
  /** Initial server-rendered snapshot, refreshed via the GET endpoint
   *  every poll cycle so model-preference changes mid-flight surface. */
  plan: string;
  productCount: number;
  costEstimate: number;
  initialActive: ActiveBulkJob | null;
  initialDetail: BulkJobStatusForUi | null;
  creditsBalance: number;
  /** Map productId → human-readable title for the failure detail
   *  modal. The component only needs the products that ended up in
   *  the bulk's perProduct map, but passing the full set keeps the
   *  data path simple. */
  productTitleById: Record<string, string>;
}

export function BulkGenerateSection({
  siteId,
  plan,
  productCount,
  costEstimate,
  initialActive,
  initialDetail,
  creditsBalance,
  productTitleById
}: BulkGenerateSectionProps) {
  const t = useTranslations('BulkGenerate');
  const [active, setActive] = useState<ActiveBulkJob | null>(initialActive);
  const [detail, setDetail] = useState<BulkJobStatusForUi | null>(initialDetail);
  const [estimate, setEstimate] = useState<{ total: number; breakdown: CostBreakdown | null }>(
    {
      total: costEstimate,
      breakdown: null
    }
  );
  const [balance, setBalance] = useState<number>(creditsBalance);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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
        creditsBalance: number;
      };
      setActive(data.active);
      setDetail(data.detail);
      setEstimate({ total: data.estimate.total, breakdown: data.estimate });
      setBalance(data.creditsBalance);
    } catch {
      /* next tick will retry */
    }
  }, [siteId]);

  // Poll while active. Also refresh once on modal open so the cost
  // shown reflects current preferences regardless of how stale the
  // SSR snapshot was.
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

  async function startBulk() {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/sites/bulk-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(t(errorKey(body.error)));
        return;
      }
      setModalOpen(false);
      await refresh();
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

  // ---------------------------------------------------------------------
  // Active progress banner (pending / running)
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
  // Post-completion summary banner (the latest bulk's outcome — we
  // keep showing it until the merchant launches another or dismisses).
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
            {plan === 'scale' && productCount > 0 ? (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90"
              >
                {t('relaunch')}
              </button>
            ) : null}
          </div>

          {detail.partiallySucceeded + detail.fullyFailed > 0 ? (
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
        </div>

        {modalOpen ? (
          <ConfirmModal
            productCount={productCount}
            costEstimate={estimate.total}
            costBreakdown={estimate.breakdown}
            balance={balance}
            insufficient={balance < estimate.total}
            submitting={submitting}
            errorMsg={errorMsg}
            onCancel={() => setModalOpen(false)}
            onConfirm={startBulk}
          />
        ) : null}
      </>
    );
  }

  // ---------------------------------------------------------------------
  // No active bulk + no recent detail → CTA card.
  // ---------------------------------------------------------------------
  const isScale = plan === 'scale';
  const insufficient = balance < estimate.total;
  const noProducts = productCount === 0;

  return (
    <>
      <div className="flex items-start gap-3 p-4 rounded-md border border-[var(--border)] bg-[var(--default)]/30">
        <Sparkles className="size-5 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
        <div className="flex-1 flex flex-col gap-1">
          <span className="font-semibold text-[var(--foreground)]">{t('title')}</span>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            {isScale ? t('subtitle', { count: productCount }) : t('upgradeHint')}
          </p>
        </div>
        {isScale ? (
          <button
            type="button"
            disabled={noProducts}
            onClick={() => setModalOpen(true)}
            className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            title={noProducts ? t('errorNoProducts') : undefined}
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
        <ConfirmModal
          productCount={productCount}
          costEstimate={estimate.total}
          costBreakdown={estimate.breakdown}
          balance={balance}
          insufficient={insufficient}
          submitting={submitting}
          errorMsg={errorMsg}
          onCancel={() => setModalOpen(false)}
          onConfirm={startBulk}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------
// Detail breakdown (atomic-failure UI)
// ---------------------------------------------------------------------

function FailureBreakdown({
  perProduct,
  productTitleById
}: {
  perProduct: Record<string, ProductBulkState>;
  productTitleById: Record<string, string>;
}) {
  const t = useTranslations('BulkGenerate');
  const fieldLabel: Record<keyof ProductBulkState['fields'], string> = {
    title: t('fieldTitle'),
    description: t('fieldDescription'),
    tags: t('fieldTags'),
    images: t('fieldImages')
  };

  // Show only products that hit at least one field error.
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
                  <li key={f} className="text-[var(--success)] inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-3" /> {fieldLabel[f]}
                  </li>
                );
              }
              return (
                <li key={f} className="text-[var(--danger)] inline-flex items-start gap-1.5">
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

// ---------------------------------------------------------------------
// Confirmation modal
// ---------------------------------------------------------------------

function ConfirmModal({
  productCount,
  costEstimate,
  costBreakdown,
  balance,
  insufficient,
  submitting,
  errorMsg,
  onCancel,
  onConfirm
}: {
  productCount: number;
  costEstimate: number;
  costBreakdown: CostBreakdown | null;
  balance: number;
  insufficient: boolean;
  submitting: boolean;
  errorMsg: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('BulkGenerate');

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-2xl max-w-md w-full p-5 flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold">{t('modalTitle')}</h3>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            {t('modalBody', { count: productCount })}
          </p>
        </div>

        <div className="flex flex-col gap-2 p-3 rounded-md bg-[var(--default)]/40 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">{t('productsLine')}</span>
            <span className="font-mono tabular-nums">{productCount}</span>
          </div>
          {costBreakdown ? (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--muted)]">
                  {t('costPerProductChat')}
                </span>
                <span className="font-mono tabular-nums">
                  {costBreakdown.perProduct.chat} cr.
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--muted)]">
                  {t('costPerProductImages')}
                </span>
                <span className="font-mono tabular-nums">
                  {costBreakdown.perProduct.images} cr.
                </span>
              </div>
              <div className="border-t border-[var(--border)] pt-2 flex justify-between text-xs">
                <span className="text-[var(--muted)]">
                  {t('costModels', {
                    chat: costBreakdown.chatModelId,
                    image: costBreakdown.imageQualityId
                  })}
                </span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between border-t border-[var(--border)] pt-2">
            <span className="font-semibold">{t('costLine')}</span>
            <span className="font-mono font-semibold tabular-nums">
              {costEstimate.toLocaleString()} cr.
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[var(--muted)]">{t('balanceLine')}</span>
            <span
              className={`font-mono tabular-nums ${
                insufficient ? 'text-[var(--danger)]' : ''
              }`}
            >
              {balance.toLocaleString()} cr.
            </span>
          </div>
        </div>

        {insufficient ? (
          <div
            role="alert"
            className="flex items-start gap-2 p-3 rounded-md bg-[var(--danger)]/5 border border-[var(--danger)]/40 text-xs text-[var(--danger)]"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
            <span>{t('errorInsufficientCredits')}</span>
          </div>
        ) : null}

        {errorMsg ? <p className="text-xs text-[var(--danger)]">{errorMsg}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 rounded-md text-sm hover:bg-[var(--default)]"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || insufficient}
            className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {submitting ? <Spinner size="sm" /> : null}
            {t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function errorKey(code: string | undefined): string {
  switch (code) {
    case 'plan_not_eligible':
      return 'errorPlanNotEligible';
    case 'bulk_already_running':
      return 'errorAlreadyRunning';
    case 'no_products':
      return 'errorNoProducts';
    case 'insufficient_credits':
      return 'errorInsufficientCredits';
    default:
      return 'errorGeneric';
  }
}
