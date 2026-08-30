'use client';

import { Spinner } from '@heroui/react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Coins,
  Layers,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { FailureBreakdown } from './failure-breakdown';
import { SelectionModal } from './selection-modal';
import type { ActiveBulkJob, BulkCandidate, BulkJobStatusForUi } from '../model/types';
import { useBulkGenerate } from './use-bulk-generate';
import {
  noFieldsSelected as prefsHasNoFields,
  type BulkPrefs
} from '@/features/bulk-generate/client';
import type { ChatModelId, ImageQualityId } from '@/entities/ai-model';

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
  /** Effective bulk prefs (site → account → legacy, resolved
   *  server-side) — seeds the modal config with no first-paint flash. */
  initialPrefs: BulkPrefs;
  /** Whether the site has its OWN prefs (vs. inheriting the account
   *  default) — drives the "reset to account default" affordance. */
  initialSiteOverride: boolean;
  /** Account-resolved models (session pref → default), seeding the
   *  modal's model picker. Picking a different one persists to the
   *  account (no site-level config) — same as the product page. */
  initialChatModel: ChatModelId;
  initialImageQuality: ImageQualityId;
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
  productTitleById,
  initialPrefs,
  initialSiteOverride,
  initialChatModel,
  initialImageQuality
}: BulkGenerateSectionProps) {
  const t = useTranslations('BulkGenerate');
  // Bulk catalog generation is unlocked from the Pro plan upwards. Free
  // and Starter see the upgrade hint instead of the CTA.
  const canBulk = plan === 'pro' || plan === 'scale';
  const {
    active,
    detail,
    candidates,
    estimate,
    balance,
    modalOpen,
    setModalOpen,
    submitting,
    cancelling,
    retrying,
    errorMsg,
    detailExpanded,
    setDetailExpanded,
    prefs,
    updatePrefs,
    launchBlocked,
    siteOverride,
    resetToAccountDefault,
    searchQuery,
    onSearch,
    chatModelId,
    imageQualityId,
    onPickChat,
    onPickImage,
    startBulk,
    cancelBulk,
    retryFailed
  } = useBulkGenerate({
    siteId,
    costEstimate,
    initialCandidates,
    initialActive,
    initialDetail,
    creditsBalance,
    initialPrefs,
    initialSiteOverride,
    initialChatModel,
    initialImageQuality
  });

  // ---------------------------------------------------------------------
  // Active progress banner
  // ---------------------------------------------------------------------
  if (active) {
    const progress =
      active.total > 0 ? Math.min(100, Math.round((active.processed / active.total) * 100)) : 0;
    return (
      <div className="flex items-start gap-3 p-4 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/5">
        <Layers className="size-5 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[var(--foreground)]">{t('bannerInProgress')}</span>
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
            <FailureBreakdown perProduct={detail.perProduct} productTitleById={productTitleById} />
          ) : null}

          {errorMsg ? <p className="text-xs text-[var(--danger)]">{errorMsg}</p> : null}
        </div>

        {modalOpen ? (
          <SelectionModal
            candidates={candidates}
            balance={balance}
            submitting={submitting}
            errorMsg={errorMsg}
            prefs={prefs}
            onChangePrefs={updatePrefs}
            launchBlocked={launchBlocked}
            siteOverride={siteOverride}
            onResetPrefs={resetToAccountDefault}
            noFields={prefsHasNoFields(prefs)}
            searchValue={searchQuery}
            onSearch={onSearch}
            chatModelId={chatModelId}
            imageQualityId={imageQualityId}
            onPickChat={onPickChat}
            onPickImage={onPickImage}
            estimateTotal={estimate.total}
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
  const noFields = prefsHasNoFields(prefs);

  return (
    <>
      {/* Stacks vertically on mobile (icon+text row on top, full-width
          CTA below) so the action isn't squeezed against the title on
          narrow screens. Above sm: switches back to the original
          side-by-side layout. */}
      <div className="flex flex-col gap-3 p-4 rounded-md border border-[var(--border)] bg-[var(--default)]/30 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Sparkles className="size-5 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-semibold text-[var(--foreground)]">{t('title')}</span>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              {!canBulk
                ? t('upgradeHint')
                : noCandidates
                  ? t('subtitleNoCandidates')
                  : t('subtitle', { count: candidates.length })}
            </p>
          </div>
        </div>
        {canBulk ? (
          <button
            type="button"
            disabled={noProducts || noCandidates}
            onClick={() => setModalOpen(true)}
            className="w-full sm:w-auto px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
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
            className="w-full sm:w-auto text-center px-3 py-2 rounded-md text-sm font-medium border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 shrink-0"
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
          prefs={prefs}
          onChangePrefs={updatePrefs}
          launchBlocked={launchBlocked}
          siteOverride={siteOverride}
          onResetPrefs={resetToAccountDefault}
          noFields={noFields}
          searchValue={searchQuery}
          onSearch={onSearch}
          chatModelId={chatModelId}
          imageQualityId={imageQualityId}
          onPickChat={onPickChat}
          onPickImage={onPickImage}
          estimateTotal={estimate.total}
          onCancel={() => setModalOpen(false)}
          onConfirm={(ids) => startBulk(ids)}
        />
      ) : null}

      {/* surface "fresh start, no bulk yet" cost estimate too */}
      {!noCandidates && estimate.breakdown ? (
        <p className="text-xs text-[var(--muted)] -mt-2 ml-1">
          {t.rich('hintFullCost', {
            count: candidates.length,
            cost: estimate.total,
            coins: () => <Coins className="size-3 inline-block align-text-bottom" aria-hidden />
          })}
        </p>
      ) : null}
    </>
  );
}
