import { resolveChatModelId } from '@/entities/ai-model';
import { ChevronLeft, Coins, ExternalLink } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { AutoRefresh, InfoHint } from '@/shared/ui';
import { CustomInstructionsField, RetryableGenerateProvider } from '@/features/retryable-generate';
import { ModelChips } from '@/widgets/model-chips';
import { AppliedToastOnMount } from '@/features/manual-catalog';
import { loadProductForUser } from '../api/load-product';
import { loadRecentChatJobs } from '../api/recent-chat-jobs';
import { AutoOptimizeOnMount } from '@/features/retryable-generate';
import {
  costForImage,
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODEL_REGISTRY,
  imageRetentionDaysForPlan,
  type ChatModelId,
  type ImageQualityId
} from '@/entities/ai-model';
import {
  listOptimHistory,
  listOptimHistoryPaginated,
  listProductImageJobs,
  suggestionsCost
} from '@/entities/generation-job';
import { auth } from '@/entities/user';
import { listProjectKeys } from '@/entities/api-key';
import { getProjectCapabilities } from '@/entities/connection-capability';
import { getConnection } from '@/entities/shop-connection';
import {
  appliedGeneratedImagesFor,
  buildProductRecap,
  isAwaitingStore,
  listChangesForJobs,
  listPendingSummaryForProduct,
  PendingChangesBanner,
  ProductImageEditor,
  ProductRecapCard,
  RECAP_FIELDS
} from '@/features/apply-to-store';
import { generateAltTextAction } from '@/features/generate-alt-text/actions';
import { altTextCredits, findCachedSuggestions } from '@/entities/generation-job';
import { isUsableKey } from '@/features/integrations';
import { touchProjectLastView } from '@/features/manage-project';
import { PastGenerationsSection } from './past-generations-section';
import { BackArrow, ScoreBadge } from './score-badge';
import { SuggestionsCard } from './suggestions-card';

const HISTORY_PAGE_SIZE = 15;

export interface DashboardProductSearchParams {
  /** Server-rendered pagination for the past-generations strip —
   *  15 entries per page, sorted by createdAt desc. */
  historyPage?: string;
}

// ============================================================================
// Page
// ============================================================================

export async function DashboardProductPage({
  siteId,
  productId,
  searchParams
}: {
  siteId: string;
  productId: string;
  searchParams: DashboardProductSearchParams;
}) {
  const { historyPage: rawHistoryPage } = searchParams;
  const historyPage = Math.max(1, Number.parseInt(rawHistoryPage ?? '1', 10) || 1);

  const session = await auth();
  if (!session?.user) redirect('/login');

  const loaded = await loadProductForUser(session.user.id, siteId, productId);
  if (!loaded) notFound();
  const {
    product,
    storeImages,
    projectId,
    productInstructions,
    productImagePrompt,
    projectInstructions,
    archived,
    isManual
  } = loaded;
  // sourceId is the audit-summary key for this product; needed for history
  // lookups and as the form payload key for AI generation jobs.
  const sourceId = product.sourceId ?? product.handle ?? '';

  // Mark this project as the user's most recently consulted store so the
  // dashboard auto-picks it on next visit.
  await touchProjectLastView(projectId);

  // The four per-field history slices feed `hasHistory` flags on the
  // AI panel — they still need their own queries (a slice of 1-2 rows
  // each is cheap). The bottom "Past generations" strip uses the new
  // unified + paginated query.
  const [titleHistory, descriptionHistory, tagsHistory, imagesHistory, liveImageJobs, pastGenPage] =
    await Promise.all([
      listOptimHistory(projectId, sourceId, 'title'),
      listOptimHistory(projectId, sourceId, 'description'),
      listOptimHistory(projectId, sourceId, 'tags'),
      listOptimHistory(projectId, sourceId, 'images'),
      listProductImageJobs(projectId, sourceId),
      listOptimHistoryPaginated(projectId, sourceId, {
        page: historyPage,
        perPage: HISTORY_PAGE_SIZE
      })
    ]);

  // Resolve the user's effective image quality so we can show the
  // matching credit cost on the Add / Regenerate tiles. Body overrides
  // for chat models live on the optim form's own state and don't apply
  // here — these tiles fire one-off image jobs at the persisted setting.
  const effectiveImageQuality: ImageQualityId =
    (session.user.preferredImageQuality as ImageQualityId | undefined) &&
    session.user.preferredImageQuality! in IMAGE_MODEL_REGISTRY
      ? (session.user.preferredImageQuality as ImageQualityId)
      : DEFAULT_IMAGE_QUALITY;
  const costPerImage = costForImage(effectiveImageQuality);
  // Plan-specific image retention drives the per-tile expiry caption
  // and is enforced server-side by the R2 cleanup worker.
  const retentionDays = imageRetentionDaysForPlan(session.user.plan ?? 'free');

  // Two related-but-different flags about image state:
  //   - hasHistory.images is consumed by FieldRow/FieldSwap to decide
  //     whether the AI side has anything to show. We want the AI side
  //     (skeletons) to surface as soon as a job is queued, so this
  //     counts pending/running too.
  //   - hasCompletedImages reflects ACTUAL delivered AI images. Used
  //     by the bottom "Generate all" button so it doesn't flip to
  //     "Regenerate all" while the user is still waiting on the first
  //     batch — which would imply the run is over when it isn't.
  const hasHistory = {
    title: titleHistory.length > 0,
    description: descriptionHistory.length > 0,
    tags: tagsHistory.length > 0,
    images: imagesHistory.length > 0 || liveImageJobs.length > 0
  };
  const hasCompletedImages = imagesHistory.length > 0;
  // "Regenerate all" only makes sense once at least one full pass has
  // landed across every field type — otherwise the click is effectively
  // a first-generation for whatever's still missing.
  const hasAnyHistory =
    hasHistory.title && hasHistory.description && hasHistory.tags && hasCompletedImages;

  const t = await getTranslations('Product');
  const tCredits = await getTranslations('Credits');

  const balance = session.user.creditsBalance ?? 0;

  // Initial model selection — the chips on the page can flip these client-side
  // (with persistence via the preferences server action). Costs and affordance
  // checks are recomputed live in RetryableGenerateProvider.
  const userChatModel: ChatModelId = resolveChatModelId(session.user.preferredChatModel);
  const userImageQuality: ImageQualityId =
    (session.user.preferredImageQuality as ImageQualityId | undefined) ?? DEFAULT_IMAGE_QUALITY;

  const { inFlightChatJobs, recentFailedChatJobs, inFlightAlts, inFlightSuggestionStartedAtMs } =
    await loadRecentChatJobs(productId);

  // Apply-to-store state per past generation + whether a plugin can pick it up.
  // `capabilities` decides whether applying images replaces the whole gallery
  // (docs/api/IMAGE-OPS.md §5) — the merchant confirms that in plain words.
  const [changeByJobId, siteKeys, connection, capabilities, pendingSummary, takenByStore] =
    await Promise.all([
      listChangesForJobs(projectId, [
        ...new Set([
          ...pastGenPage.items.map((h) => h.jobId),
          // The field rows send the newest generation of each field, which is
          // not necessarily on the first page of the history.
          ...[titleHistory[0], descriptionHistory[0], tagsHistory[0]]
            .filter((h) => h != null)
            .map((h) => h.jobId)
        ])
      ]),
      listProjectKeys({ projectId, userId: session.user.id }),
      getConnection(projectId),
      getProjectCapabilities(projectId),
      listPendingSummaryForProduct(productId, session.user.id),
      // Visuals the store already took: they are store photos now, and showing
      // the generation beside them reads as a duplicate.
      appliedGeneratedImagesFor(productId)
    ]);
  // A store can take a change through either path: the plugin polling with a
  // site key, or a connector the merchant installed (Shopify, Wix). Reading
  // only the keys told every OAuth-connected merchant to "connect your store"
  // on a store that was connected, and hid the apply button entirely.
  // `connected` is the same status the worker's apply pass requires.
  const canApplyToStore =
    siteKeys.some((k) => isUsableKey(k)) || connection?.status === 'connected';
  const appliesVia = connection?.status === 'connected' ? 'connector' : 'plugin';
  // A change is in flight. A connector applies it within seconds, a polling
  // plugin within minutes — either way the page must reach "applied" on its
  // own, or the merchant is left reading a chip that says "queued" next to a
  // panel that says nothing is queued.
  const changeInFlight = isAwaitingStore(pendingSummary.counts);
  const cachedSuggestions =
    (await findCachedSuggestions(projectId, sourceId, 'description'))?.suggestions ?? [];
  // What is waiting on the merchant, per field. A generation only enters the
  // store-side counters once they click Apply, so without this a rewritten set
  // of tags nobody applied showed up nowhere on the page.
  const recapRows = buildProductRecap(
    RECAP_FIELDS.map((field) => {
      const latest = { title: titleHistory, description: descriptionHistory, tags: tagsHistory }[
        field
      ][0];
      const change = latest ? (changeByJobId[latest.jobId] ?? null) : null;
      return {
        field,
        jobId: latest?.jobId ?? null,
        change: change ? { status: change.status, approvedAtIso: change.approvedAtIso } : null
      };
    })
  );

  return (
    <main className="flex-1 p-4 md:p-10 max-w-5xl w-full mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <Link
          href={`/dashboard/sites/${siteId}?tab=products`}
          className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] inline-flex items-center gap-1.5 transition-colors"
        >
          <BackArrow />
          {t('backToDashboard')}
        </Link>
        <div className="flex items-center gap-3">
          <ScoreBadge score={product.score} />
          <span className="text-sm text-[var(--muted)] font-mono inline-flex items-center gap-1">
            <Coins className="size-3.5" aria-hidden />
            {balance}
            <InfoHint topic="credits" label={tCredits('balanceLabel')} />
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {product.url ? (
          <a
            href={product.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 w-fit max-w-full hover:text-[var(--accent)] transition-colors"
          >
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight">
              {product.title}
            </h1>
            <ExternalLink className="size-5 opacity-60 shrink-0" aria-hidden />
          </a>
        ) : (
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight">
            {product.title}
          </h1>
        )}
      </div>

      {/* One block about this product's changes, not two. The recap says where
          each generation stands; the banner only added a count of the subset
          already sent, which the recap's own lines carry. It stays for the
          cases the recap has no words for — a conflict or a failure, which
          open the recap modal. */}
      <ProductRecapCard rows={recapRows} projectId={projectId} productId={productId} />
      {pendingSummary.counts.conflict + pendingSummary.counts.failed > 0 ? (
        <PendingChangesBanner
          projectId={projectId}
          counts={pendingSummary.counts}
          items={pendingSummary.items}
          scope="product"
        />
      ) : null}

      {archived ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--border)] bg-[var(--default)]/40 p-4 flex items-start gap-3 text-sm"
        >
          <ChevronLeft
            className="size-4 mt-0.5 text-[var(--muted)] shrink-0 rotate-180"
            aria-hidden
          />
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-[var(--foreground)]">{t('archivedTitle')}</span>
            <span className="text-[var(--muted)] leading-relaxed">{t('archivedBody')}</span>
          </div>
        </div>
      ) : null}

      <AppliedToastOnMount />

      <RetryableGenerateProvider
        siteId={siteId}
        productId={productId}
        initialChatModelId={userChatModel}
        initialImageQualityId={userImageQuality}
        initialCustomInstructions={productInstructions}
        creditsBalance={balance}
        productArchived={archived}
        inFlightChatJobs={inFlightChatJobs}
        recentFailedChatJobs={recentFailedChatJobs}
      >
        <AutoOptimizeOnMount productId={productId} />
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <ModelChips />
            <CustomInstructionsField
              hasSiteInstructions={projectInstructions.trim().length > 0}
              productId={productId}
              savedValue={productInstructions}
              suggestions={{
                productId,
                cost: suggestionsCost(),
                creditsBalance: balance,
                // Already generated and paid for: leaving the page used to
                // hide them for good, so the merchant paid twice for the same
                // five angles or simply never saw them again.
                initial: cachedSuggestions,
                startedAtMs: inFlightSuggestionStartedAtMs
              }}
            />
          </div>

          <SuggestionsCard
            siteId={siteId}
            productId={productId}
            projectId={projectId}
            product={product}
            archived={archived}
            isManual={isManual}
            hasHistory={hasHistory}
            hasCompletedImages={hasCompletedImages}
            hasAnyHistory={hasAnyHistory}
            titleHistory={titleHistory}
            descriptionHistory={descriptionHistory}
            tagsHistory={tagsHistory}
            liveImageJobs={liveImageJobs}
            costPerImage={costPerImage}
            retentionDays={retentionDays}
            changeByJobId={changeByJobId}
            canApplyToStore={canApplyToStore}
            appliesVia={appliesVia}
            savedImagePrompt={productImagePrompt}
          />
        </div>
      </RetryableGenerateProvider>

      {/* Step 3 of docs/api/IMAGE-OPS.md §6: the merchant arranges their own
          gallery — every action is one the connection declared it can do. */}
      <ProductImageEditor
        productId={productId}
        storeImages={storeImages}
        generated={liveImageJobs.flatMap((j) =>
          j.status === 'completed' && j.imageUrl && !takenByStore.has(j.imageUrl)
            ? [{ jobId: j.id, src: j.imageUrl, alt: null }]
            : []
        )}
        capabilities={capabilities}
        archived={archived}
        generateAlt={generateAltTextAction}
        altCost={altTextCredits()}
        sending={changeInFlight}
        inFlightAlts={inFlightAlts}
        sentOps={pendingSummary.items
          .filter((i) => i.status === 'pending' && i.detail.kind === 'imageOps')
          .flatMap((i) => (i.detail.kind === 'imageOps' ? i.detail.ops : []))}
      />

      <PastGenerationsSection
        title={t('generationsHistory')}
        emptyText={t('generationHistoryEmpty')}
        items={pastGenPage.items}
        retentionDays={retentionDays}
        page={historyPage}
        totalPages={pastGenPage.totalPages}
        siteId={siteId}
        archived={archived}
        canApplyToStore={canApplyToStore}
        appliesVia={appliesVia}
        changeByJobId={changeByJobId}
        replaceAllImages={!capabilities.stableImageIds}
        currentImageCount={product.images.length}
      />
      {/* Anything the server knows is running: a store change on its way, an
          alt text being written, a round of angles. Resuming them after a
          refresh is only half the job — the page has to reach their outcome
          too, or the merchant is left watching a timer that never ends. */}
      {changeInFlight || inFlightAlts.length > 0 || inFlightSuggestionStartedAtMs != null ? (
        <AutoRefresh intervalMs={5000} />
      ) : null}
    </main>
  );
}
