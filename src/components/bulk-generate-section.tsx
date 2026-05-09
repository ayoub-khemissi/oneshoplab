'use client';

import { Spinner } from '@heroui/react';
import { Sparkles, Layers, AlertTriangle } from 'lucide-react';
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

interface BulkGenerateSectionProps {
  siteId: string;
  /** The merchant's current plan id. Bulk generation is gated to scale. */
  plan: string;
  /** Eligible (non-archived) product count for the site, used by the
   *  pre-flight estimate shown in the confirmation modal. */
  productCount: number;
  /** Pre-computed cost estimate from the server: chat × 4 fields × N
   *  products + image × 3 angles × N products at the user's models. */
  costEstimate: number;
  /** Server-side snapshot of any in-flight bulk job for this site, so
   *  the banner doesn't flash empty on mount. The component then
   *  polls the API for live progress. */
  initialActive: ActiveBulkJob | null;
  creditsBalance: number;
}

/**
 * Bulk catalog generation entry point on the per-site dashboard. Two
 * states:
 *
 *   1. A bulk job is in flight → progress banner with a poll loop.
 *   2. No bulk → "Generate for all products" button (Scale only) or
 *      a disabled card hinting at the upgrade for non-Scale plans.
 *
 * The actual processing happens worker-side, one product per tick;
 * this component is read-only after the merchant confirms the launch.
 */
export function BulkGenerateSection({
  siteId,
  plan,
  productCount,
  costEstimate,
  initialActive,
  creditsBalance
}: BulkGenerateSectionProps) {
  const t = useTranslations('BulkGenerate');
  const [active, setActive] = useState<ActiveBulkJob | null>(initialActive);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollOnce = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sites/bulk-generate?siteId=${encodeURIComponent(siteId)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { active: ActiveBulkJob | null };
      setActive(data.active);
    } catch {
      // Silent: next tick retries.
    }
  }, [siteId]);

  // Poll while a bulk job is non-terminal. Cheaper than a full refresh
  // and lets the merchant watch progress without a manual reload.
  useEffect(() => {
    if (!active || active.status === 'completed' || active.status === 'failed') {
      return;
    }
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      pollOnce();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, pollOnce]);

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
      await pollOnce();
    } finally {
      setSubmitting(false);
    }
  }

  if (active) {
    const progress =
      active.total > 0 ? Math.min(100, Math.round((active.processed / active.total) * 100)) : 0;
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
      </div>
    );
  }

  // No bulk in flight. Button + plan gate.
  const isScale = plan === 'scale';
  const insufficient = creditsBalance < costEstimate;
  const noProducts = productCount === 0;

  return (
    <>
      <div className="flex items-start gap-3 p-4 rounded-md border border-[var(--border)] bg-[var(--default)]/30">
        <Sparkles className="size-5 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
        <div className="flex-1 flex flex-col gap-1">
          <span className="font-semibold text-[var(--foreground)]">
            {t('title')}
          </span>
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
          costEstimate={costEstimate}
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

function ConfirmModal({
  productCount,
  costEstimate,
  insufficient,
  submitting,
  errorMsg,
  onCancel,
  onConfirm
}: {
  productCount: number;
  costEstimate: number;
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

        <div className="flex flex-col gap-2 p-3 rounded-md bg-[var(--default)]/40">
          <div className="flex justify-between text-sm">
            <span className="text-[var(--muted)]">{t('costLine')}</span>
            <span className="font-mono font-semibold tabular-nums">
              {costEstimate.toLocaleString()} cr.
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--muted)]">{t('productsLine')}</span>
            <span className="font-mono tabular-nums">{productCount}</span>
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

        {errorMsg ? (
          <p className="text-xs text-[var(--danger)]">{errorMsg}</p>
        ) : null}

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
