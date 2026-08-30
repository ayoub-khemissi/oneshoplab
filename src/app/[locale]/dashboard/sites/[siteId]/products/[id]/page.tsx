import { resolveChatModelId } from '@/entities/ai-model';
import { ChevronLeft, Coins, ExternalLink } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { CustomInstructionsField, RetryableGenerateProvider } from '@/features/retryable-generate';
import { ModelChips } from '@/widgets/model-chips';
import { AppliedToastOnMount } from '@/components/applied-toast-on-mount';
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
  listProductImageJobs
} from '@/entities/generation-job';
import { auth } from '@/lib/auth';
import { touchProjectLastView } from '@/lib/auth-actions';
import { PastGenerationsSection } from './_components/past-generations-section';
import { BackArrow, ScoreBadge } from './_components/score-badge';
import { SuggestionsCard } from './_components/suggestions-card';
import { loadProductForUser } from './_lib/load-product';
import { loadRecentChatJobs } from './_lib/recent-chat-jobs';

export const dynamic = 'force-dynamic';

const HISTORY_PAGE_SIZE = 15;

interface PageProps {
  params: Promise<{ id: string; siteId: string }>;
  searchParams: Promise<{
    /** Server-rendered pagination for the past-generations strip —
     *  15 entries per page, sorted by createdAt desc. */
    historyPage?: string;
  }>;
}

// ============================================================================
// Page
// ============================================================================

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const { id: productId, siteId } = await params;
  const { historyPage: rawHistoryPage } = await searchParams;
  const historyPage = Math.max(1, Number.parseInt(rawHistoryPage ?? '1', 10) || 1);

  const session = await auth();
  if (!session?.user) redirect('/login');

  const loaded = await loadProductForUser(session.user.id, siteId, productId);
  if (!loaded) notFound();
  const { product, projectId, productInstructions, projectInstructions, archived, isManual } =
    loaded;
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

  const balance = session.user.creditsBalance ?? 0;

  // Initial model selection — the chips on the page can flip these client-side
  // (with persistence via the preferences server action). Costs and affordance
  // checks are recomputed live in RetryableGenerateProvider.
  const userChatModel: ChatModelId = resolveChatModelId(session.user.preferredChatModel);
  const userImageQuality: ImageQualityId =
    (session.user.preferredImageQuality as ImageQualityId | undefined) ?? DEFAULT_IMAGE_QUALITY;

  const { inFlightChatJobs, recentFailedChatJobs } = await loadRecentChatJobs(productId);

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
            <CustomInstructionsField hasSiteInstructions={projectInstructions.trim().length > 0} />
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
          />
        </div>
      </RetryableGenerateProvider>

      <PastGenerationsSection
        title={t('generationsHistory')}
        emptyText={t('generationHistoryEmpty')}
        items={pastGenPage.items}
        retentionDays={retentionDays}
        page={historyPage}
        totalPages={pastGenPage.totalPages}
      />
    </main>
  );
}
