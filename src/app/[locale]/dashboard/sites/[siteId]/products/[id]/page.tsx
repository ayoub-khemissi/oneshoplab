import { Accordion, Card } from '@heroui/react';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { ChevronLeft, Coins, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { CopyButton } from '@/components/copy-button';
import { DownloadAllButton } from '@/components/download-all-button';
import type { GenField } from '@/components/generate-button';
import {
  CustomInstructionsField,
  RetryableGenerateButton,
  RetryableGenerateProvider
} from '@/components/retryable-generate';
import { ModelChips } from '@/components/model-chips';
import {
  FieldSwap,
  FieldSwapGroup,
  FieldSwapGroupToggle,
  FieldViewProvider
} from '@/components/field-swap';
import { ImageExpiry } from '@/components/image-expiry';
import { ImageZoom } from '@/components/image-zoom';
import { ProductImageGallery } from '@/components/product-image-gallery';
import { TagPills } from '@/components/tag-pills';
import { AiImageGridLive } from '@/components/ai-image-grid-live';
import { AppliedToastOnMount } from '@/components/applied-toast-on-mount';
import { ApplyAiButton } from '@/components/apply-ai-button';
import { AutoOptimizeOnMount } from '@/components/auto-optimize-on-mount';
import { HistoryImage } from '@/components/history-image';
import { ServerPagination } from '@/components/server-pagination';
import {
  costForImage,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODEL_REGISTRY,
  imageRetentionDaysForPlan,
  listOptimHistory,
  listOptimHistoryPaginated,
  listProductImageJobs,
  type ChatModelId,
  type ChatOptimField,
  type ImageQualityId,
  type OptimHistoryItem
} from '@/lib/ai';
import { auth } from '@/lib/auth';
import { touchProjectLastView } from '@/lib/auth-actions';
import { InsufficientCreditsError } from '@/lib/credits';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/format-date';
import { audits, jobs, products, projects } from '@/lib/db/schema';

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

interface ProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

interface ProductVariant {
  id: string;
  title: string | null;
  price: number;
  options: Record<string, string>;
}

interface ProductSnapshot {
  sourceId: string | null;
  handle: string | null;
  title: string;
  url: string | null;
  descriptionHtml: string;
  images: ProductImage[];
  variants: ProductVariant[];
  score: number;
  signals: {
    tags: string[];
    vendor: string | null;
    productType: string | null;
    descriptionTextLength?: number;
    imageCount?: number;
    priceMin?: number | null;
    priceMax?: number | null;
  };
}

interface SummaryShape {
  worstProducts?: ProductSnapshot[];
  bestProducts?: ProductSnapshot[];
  latestProducts?: ProductSnapshot[];
  allProducts?: ProductSnapshot[];
}

// ============================================================================
// Data loading
// ============================================================================

interface LoadedProduct {
  projectId: string;
  product: ProductSnapshot;
  /** Soft-archived: not in the latest scrape. Banner is shown and
   *  generation buttons are disabled. */
  archived: boolean;
  /** Last per-product instructions persisted by the API on previous
   *  generations. Pre-fills the textarea on render. */
  productInstructions: string;
  /** Site-wide instructions configured on the project. Surfaced as a hint
   *  on the product page so the merchant knows extra guidance is in flight. */
  projectInstructions: string;
  /** True when the parent project is a from-scratch / manual store
   *  (no upstream Shopify/WooCommerce/Wix). Unlocks the "Apply AI
   *  to my product" CTA, since for scraped sites the source of
   *  truth lives upstream and overwriting locally would be lossy. */
  isManual: boolean;
}

async function loadProductForUser(
  userId: string,
  siteId: string,
  productId: string
): Promise<LoadedProduct | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.id, siteId))
  });
  if (!project) return null;

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, project.id))
  });
  if (!productRow) return null;

  const { findLatestAuditForProject } = await import('@/lib/audit/find-latest');
  const audit = await findLatestAuditForProject(project.id, project.domain);

  const summary = (audit?.summary ?? null) as SummaryShape | null;

  let product: ProductSnapshot | null = null;
  if (summary) {
    const all = [
      ...(summary.allProducts ?? []),
      ...(summary.worstProducts ?? []),
      ...(summary.latestProducts ?? []),
      ...(summary.bestProducts ?? [])
    ];
    // Match strategy is sourceId-first ACROSS THE WHOLE ARRAY, then
    // handle as a strict fallback. Some upstream platforms emit the
    // same handle for many distinct products (WooCommerce slug
    // collisions, recycled slugs after a delete-and-recreate, …),
    // so a per-item `sourceId || handle` check would return the
    // wrong row whenever a handle collision lives earlier in the
    // array than the actual sourceId. Two passes is cheap (O(n))
    // and unambiguous.
    const byId =
      productRow.sourceId
        ? all.find((p) => p.sourceId === productRow.sourceId)
        : undefined;
    const byHandle =
      !byId && productRow.handle
        ? all.find((p) => p.handle === productRow.handle)
        : undefined;
    const match = byId ?? byHandle ?? null;
    if (match) {
      // productRow stays the canonical source for the join key the
      // rest of the page uses (sourceId / handle drive history
      // lookups against jobs.input_payload.productSourceId). The
      // summary's sourceId can be re-issued by the upstream store
      // for the same handle on a re-scrape — using it would
      // silently invalidate every historical generation. So we
      // overlay the summary's score / signals onto the productRow
      // identifiers, never the other way around.
      product = {
        ...match,
        sourceId: productRow.sourceId,
        handle: productRow.handle,
        url: match.url ?? productRow.sourceUrl,
        title: match.title || productRow.title
      };
    }
  }

  // Archived path: product is missing from the latest summary OR explicitly
  // flagged on the products row. Synthesize a snapshot from the persisted
  // metadata so the page still renders (banner + disabled CTAs handled
  // downstream). The score is unknown here — show 0 / "—" downstream.
  if (!product || productRow.status === 'archived') {
    product = {
      sourceId: productRow.sourceId,
      handle: productRow.handle,
      title: productRow.title,
      url: productRow.sourceUrl,
      descriptionHtml: productRow.descriptionHtml ?? '',
      images: (productRow.images ?? []) as ProductImage[],
      variants: ((productRow.variants ?? []) as unknown as ProductVariant[]) ?? [],
      score: product?.score ?? 0,
      signals: {
        tags: (productRow.tags ?? []) as string[],
        vendor: productRow.vendor,
        productType: productRow.productType,
        priceMin: productRow.priceMin != null ? Number(productRow.priceMin) : null,
        priceMax: productRow.priceMax != null ? Number(productRow.priceMax) : null
      }
    };
  }

  return {
    projectId: project.id,
    product,
    archived: productRow.status === 'archived',
    productInstructions: productRow.customInstructions ?? '',
    projectInstructions: project.customInstructions ?? '',
    isManual: project.source === 'manual'
  };
}

// ============================================================================
// Page
// ============================================================================

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const { id: productId, siteId } = await params;
  const { historyPage: rawHistoryPage } = await searchParams;
  const historyPage = Math.max(
    1,
    Number.parseInt(rawHistoryPage ?? '1', 10) || 1
  );

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
  const [
    titleHistory,
    descriptionHistory,
    tagsHistory,
    imagesHistory,
    liveImageJobs,
    pastGenPage
  ] = await Promise.all([
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
    hasHistory.title &&
    hasHistory.description &&
    hasHistory.tags &&
    hasCompletedImages;

  const t = await getTranslations('Product');
  const tReport = await getTranslations('Report');

  const balance = session.user.creditsBalance ?? 0;

  // Initial model selection — the chips on the page can flip these client-side
  // (with persistence via the preferences server action). Costs and affordance
  // checks are recomputed live in RetryableGenerateProvider.
  const userChatModel: ChatModelId =
    (session.user.preferredChatModel as ChatModelId | undefined) ?? DEFAULT_CHAT_MODEL;
  const userImageQuality: ImageQualityId =
    (session.user.preferredImageQuality as ImageQualityId | undefined) ?? DEFAULT_IMAGE_QUALITY;

  // In-flight chat generations — the user may have clicked "Generate
  // title" then F5'd before kie returned. We surface a 'running' chat
  // job per matching field so the provider restores the spinner on
  // mount instead of looking idle. 5-min cutoff filters out orphaned
  // rows: kie chat is hard-capped at 90s and our catch flips the row
  // to 'failed' on any throw — anything older than 5 min means the
  // server died mid-chat (very rare), and the safest behaviour is to
  // not show a forever-spinner to the user.
  const STALE_RUNNING_CUTOFF = new Date(Date.now() - 5 * 60 * 1000);
  const runningChatJobs = await db
    .select({ kind: jobs.kind, startedAt: jobs.startedAt })
    .from(jobs)
    .where(
      and(
        eq(jobs.productId, productId),
        eq(jobs.status, 'running'),
        inArray(jobs.kind, ['kie_title', 'kie_description', 'kie_tags'])
      )
    );
  const inFlightChatFields: ChatOptimField[] = [];
  for (const row of runningChatJobs) {
    if (row.startedAt && row.startedAt < STALE_RUNNING_CUTOFF) continue;
    if (row.kind === 'kie_title') inFlightChatFields.push('title');
    else if (row.kind === 'kie_description') inFlightChatFields.push('description');
    else if (row.kind === 'kie_tags') inFlightChatFields.push('tags');
  }

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
          <ChevronLeft className="size-4 mt-0.5 text-[var(--muted)] shrink-0 rotate-180" aria-hidden />
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
        inFlightChatFields={inFlightChatFields}
      >
        <AutoOptimizeOnMount productId={productId} />
        <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <ModelChips />
          <CustomInstructionsField hasSiteInstructions={projectInstructions.trim().length > 0} />
        </div>

        <Card variant="secondary" className="overflow-hidden">
          <div className="grid md:grid-cols-[260px_1fr]">
            <SourcePreview product={product} />

            <FieldSwapGroup>
              <div className="px-5 pt-5 pb-5 md:pt-0 md:pb-0 flex flex-col gap-5 border-t md:border-t-0 md:border-l border-[var(--border)]">
                <div className="flex flex-col gap-2">
                  <span className="eyebrow text-center sm:text-left">AI suggestions</span>
                  {/* Desktop: actions on the left, source/AI toggle on
                      the right (matches the per-field rows below).
                      Mobile: stacks vertically, centered, same order. */}
                  <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:flex-wrap">
                    <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-2">
                      <RetryableGenerateButton field="all" hasHistory={hasAnyHistory} />
                      {isManual && !archived ? (
                        <ApplyAiButton
                          projectId={projectId}
                          productId={productId}
                          available={{
                            title: hasHistory.title,
                            description: hasHistory.description,
                            tags: hasHistory.tags,
                            images: hasCompletedImages
                          }}
                        />
                      ) : null}
                    </div>
                    <FieldSwapGroupToggle
                      sourceLabel={tReport('swapSource')}
                      aiLabel={tReport('swapAi')}
                      // Toggle has `self-start` baked in, which on a
                      // flex-col parent (mobile) anchors it left. Force
                      // center on mobile, let desktop fall back to the
                      // parent's items-center.
                      className="!self-center sm:!self-auto"
                    />
                  </div>
                </div>

                <FieldRow field="title" hasHistory={hasHistory.title}>
                  <FieldSwap
                    label={{
                      source: tReport('sourceTitleLabel'),
                      ai: tReport('aiTitle')
                    }}
                    sourceLabel={tReport('swapSource')}
                    aiLabel={tReport('swapAi')}
                    aiAction={
                      titleHistory[0] && typeof titleHistory[0].output === 'string' ? (
                        <CopyButton
                          value={titleHistory[0].output}
                          label={tReport('copyText')}
                          copiedLabel={tReport('copied')}
                        />
                      ) : null
                    }
                    source={
                      <p className="text-sm text-[var(--muted)]">{product.title || '—'}</p>
                    }
                    ai={
                      titleHistory[0] && typeof titleHistory[0].output === 'string' ? (
                        <p className="font-semibold">{titleHistory[0].output}</p>
                      ) : (
                        <NoLatestGen />
                      )
                    }
                  />
                </FieldRow>

                <FieldRow field="description" hasHistory={hasHistory.description}>
                  <FieldSwap
                    label={{
                      source: tReport('sourceDescriptionLabel'),
                      ai: tReport('aiDescription')
                    }}
                    sourceLabel={tReport('swapSource')}
                    aiLabel={tReport('swapAi')}
                    aiAction={
                      descriptionHistory[0] &&
                      typeof descriptionHistory[0].output === 'string' ? (
                        // Two adjacent copy buttons: one preserves the HTML
                        // formatting (paste into Shopify / WooCommerce rich
                        // editors keeps <p>, <ul>, <strong>), the other
                        // strips tags so a paste into a plain-text field or
                        // an email reads cleanly.
                        <div className="inline-flex items-center gap-1.5">
                          <CopyButton
                            value={descriptionHistory[0].output as string}
                            asHtml
                            label={tReport('copyHtml')}
                            copiedLabel={tReport('copied')}
                          />
                          <CopyButton
                            value={(descriptionHistory[0].output as string)
                              .replace(/<[^>]+>/g, ' ')
                              .replace(/\s+/g, ' ')
                              .trim()}
                            label={tReport('copyPlain')}
                            copiedLabel={tReport('copied')}
                          />
                        </div>
                      ) : null
                    }
                    source={
                      product.descriptionHtml ? (
                        <div
                          className="prose prose-sm dark:prose-invert max-w-none text-sm opacity-80"
                          dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
                        />
                      ) : (
                        <p className="text-sm text-[var(--muted)] italic">—</p>
                      )
                    }
                    ai={
                      descriptionHistory[0] &&
                      typeof descriptionHistory[0].output === 'string' ? (
                        <div
                          className="prose prose-sm dark:prose-invert max-w-none text-sm"
                          dangerouslySetInnerHTML={{
                            __html: descriptionHistory[0].output
                          }}
                        />
                      ) : (
                        <NoLatestGen />
                      )
                    }
                  />
                </FieldRow>

                <FieldRow field="tags" hasHistory={hasHistory.tags}>
                  <FieldSwap
                    label={{
                      source: tReport('sourceTagsLabel'),
                      ai: tReport('aiTags')
                    }}
                    sourceLabel={tReport('swapSource')}
                    aiLabel={tReport('swapAi')}
                    source={
                      <TagPills
                        tags={product.signals.tags ?? []}
                        variant="muted"
                        copyLabel={tReport('copyTags')}
                        copiedLabel={tReport('copied')}
                      />
                    }
                    ai={
                      tagsHistory[0] && Array.isArray(tagsHistory[0].output) ? (
                        <TagPills
                          tags={tagsHistory[0].output}
                          variant="accent"
                          copyLabel={tReport('copyTags')}
                          copiedLabel={tReport('copied')}
                        />
                      ) : (
                        <NoLatestGen />
                      )
                    }
                  />
                </FieldRow>

                <FieldRow
                  field="images"
                  hasHistory={hasHistory.images}
                  available={product.images.length > 0}
                >
                  <FieldSwap
                    label={{
                      source: tReport('sourceImagesLabel'),
                      ai: tReport('aiImagesLabel')
                    }}
                    sourceLabel={tReport('swapSource')}
                    aiLabel={tReport('swapAi')}
                    sourceAction={
                      product.images.length > 0 ? (
                        <DownloadAllButton
                          urls={product.images.map((img) => img.src)}
                          prefix="source-image"
                          zipName="source-images"
                          label={tReport('downloadAll')}
                        />
                      ) : null
                    }
                    aiAction={(() => {
                      // Download-all only over images visible AND completed —
                      // i.e. the same set the merchant currently sees in the
                      // live grid. Pending/failed/hidden jobs are excluded.
                      const aiUrls = liveImageJobs
                        .filter(
                          (j) =>
                            j.status === 'completed' &&
                            typeof j.imageUrl === 'string' &&
                            j.imageUrl.length > 0
                        )
                        .map((j) => j.imageUrl as string);
                      return aiUrls.length > 0 ? (
                        <DownloadAllButton
                          urls={aiUrls}
                          prefix="ai-image"
                          zipName="ai-images"
                          label={tReport('downloadAll')}
                        />
                      ) : null;
                    })()}
                    source={<SourceImageGrid images={product.images} />}
                    ai={
                      <AiImageGridLive
                        siteId={siteId}
                        productId={productId}
                        initial={liveImageJobs}
                        costPerImage={costPerImage}
                        retentionDays={retentionDays}
                      />
                    }
                  />
                </FieldRow>
              </div>
            </FieldSwapGroup>
          </div>
        </Card>
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

// ============================================================================
// Pieces
// ============================================================================

function FieldRow({
  field,
  hasHistory,
  available = true,
  children
}: {
  field: 'title' | 'description' | 'tags' | 'images';
  hasHistory: boolean;
  available?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Wrap both the FieldSwap (in `children`) and the Regenerate
    // button in a shared per-field view context so clicking
    // Regenerate can flip this section to AI without disturbing
    // sibling sections.
    <FieldViewProvider>
      <div className="flex flex-col gap-2 pb-5 last:pb-0 border-b last:border-b-0 border-[var(--border)]">
        {children}
        <div className="flex justify-end">
          <RetryableGenerateButton
            field={field}
            hasHistory={hasHistory}
            available={available}
          />
        </div>
      </div>
    </FieldViewProvider>
  );
}

function NoLatestGen() {
  const t = useTranslations('Product');
  return <p className="text-sm text-[var(--muted)] italic">{t('noLatestGeneration')}</p>;
}


function SourcePreview({ product }: { product: ProductSnapshot }) {
  const t = useTranslations('Report');
  const description = product.descriptionHtml
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const descriptionExcerpt =
    description.length > 160 ? `${description.slice(0, 160)}…` : description;
  const category = product.signals.productType?.trim() || null;

  return (
    <div className="bg-[var(--default)] flex flex-col">
      <ProductImageGallery
        images={product.images.map((i) => ({ src: i.src, alt: i.alt }))}
        emptyLabel={t('aiNoImage')}
      />
      <div className="p-4 flex flex-col gap-2">
        <span className="eyebrow">{t('aiSourceLabel')}</span>
        {product.url ? (
          <a
            href={product.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-start gap-1.5 hover:text-[var(--accent)] transition-colors group/title"
          >
            <h3 className="font-semibold leading-tight line-clamp-2">
              {product.title}
            </h3>
            <ExternalLink
              className="size-3.5 mt-0.5 shrink-0 opacity-50 group-hover/title:opacity-100 transition-opacity"
              aria-hidden
            />
          </a>
        ) : (
          <h3 className="font-semibold leading-tight line-clamp-2">{product.title}</h3>
        )}
        {category ? (
          <span className="self-start text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] inline-flex items-center gap-1">
            {category}
          </span>
        ) : null}
        {descriptionExcerpt ? (
          <p className="text-xs text-[var(--muted)] line-clamp-3">{descriptionExcerpt}</p>
        ) : null}
      </div>
    </div>
  );
}

function SourceImageGrid({ images }: { images: ProductImage[] }) {
  const t = useTranslations('Report');
  if (images.length === 0) {
    return <p className="text-sm text-[var(--muted)] italic">{t('aiNoImage')}</p>;
  }
  const cols =
    images.length === 1 ? 'grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-3';
  return (
    <div className={`grid gap-2 ${cols}`}>
      {images.map((img, i) => (
        <ImageZoom
          key={`${img.src}-${i}`}
          url={img.src}
          alt={img.alt ?? ''}
          downloadName={`source-${i + 1}.jpg`}
        />
      ))}
    </div>
  );
}

const PAST_GEN_DETAIL_LIMIT = 600;

function PastGenerationsSection({
  title,
  emptyText,
  items,
  retentionDays,
  page,
  totalPages
}: {
  title: string;
  emptyText: string;
  items: OptimHistoryItem[];
  /** Plan-specific retention; surfaces on the per-image expiry caption
   *  so the past-generations panel matches the live grid. */
  retentionDays: number;
  page: number;
  totalPages: number;
}) {
  const tDash = useTranslations('Dashboard');
  if (items.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-[var(--muted)] italic">{emptyText}</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Card variant="secondary" className="p-0">
        <Accordion>
          {items.map((h) => (
            <Accordion.Item
              key={h.jobId}
              id={h.jobId}
              className="border-b border-[var(--border)] last:border-b-0"
            >
              <Accordion.Heading>
                <Accordion.Trigger className="w-full px-4 py-3 flex items-center gap-3 text-sm text-left hover:bg-[var(--default)]/40 transition-colors">
                  <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium shrink-0 min-w-[7rem]">
                    {tDash(pastGenLabelKey(h.field))}
                  </span>
                  <span className="flex-1 truncate text-[var(--muted)]">
                    {pastGenInlinePreview(h.output)}
                  </span>
                  {h.field === 'images' ? (
                    <ImageExpiry
                      createdAt={h.createdAt}
                      retentionDays={retentionDays}
                      expiredAt={h.expiredAt}
                      className="shrink-0"
                    />
                  ) : null}
                  {h.creditsCost > 0 ? (
                    <span className="text-xs text-[var(--muted)] font-mono tabular-nums shrink-0 inline-flex items-center gap-1">
                      <Coins className="size-3" aria-hidden />
                      {h.creditsCost}
                    </span>
                  ) : null}
                  <span className="text-xs text-[var(--muted)] font-mono tabular-nums shrink-0">
                    {formatDate(h.createdAt)}
                  </span>
                  <Accordion.Indicator className="size-3.5 text-[var(--muted)] shrink-0" />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="px-4 py-3 bg-[var(--default)]/30 text-xs">
                  <PastGenResult item={h} />
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Card>
      <ServerPagination
        currentPage={page}
        totalPages={totalPages}
        ariaLabel="Past generations pagination"
        hrefForPage={(p) => `?historyPage=${p}`}
      />
    </section>
  );
}

function pastGenLabelKey(field: OptimHistoryItem['field']): string {
  switch (field) {
    case 'title': return 'jobKindTitle';
    case 'description': return 'jobKindDescription';
    case 'tags': return 'jobKindTags';
    case 'images': return 'jobKindImageEdit';
  }
}

/** Single-line preview shown next to the action label in the collapsed row. */
function pastGenInlinePreview(output: string | string[]): string {
  if (Array.isArray(output)) {
    if (output.length === 0) return '';
    if (typeof output[0] === 'string' && /^https?:\/\//.test(output[0])) {
      return `${output.length} image(s)`;
    }
    return output.slice(0, 5).join(', ');
  }
  if (typeof output === 'string') return stripHtmlPreview(output, 100);
  return '';
}

/**
 * Detail panel: shows ONLY the result. The prompt is intentionally hidden so
 * we don't expose our prompt-engineering wording to merchants.
 */
function PastGenResult({ item }: { item: OptimHistoryItem }) {
  if (item.field === 'images' && Array.isArray(item.output)) {
    const urls = item.output.filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (urls.length === 0) {
      // Tombstoned by the cleanup worker (or legacy job whose URLs
      // never landed). Render a single placeholder tile via
      // HistoryImage with no URL — the component handles the
      // "broken" state out of the box.
      return (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <HistoryImage url="" />
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {urls.slice(0, 6).map((url) => (
          <HistoryImage key={url} url={url} />
        ))}
      </div>
    );
  }
  if (item.field === 'tags' && Array.isArray(item.output)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {item.output.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] font-mono"
          >
            {tag}
          </span>
        ))}
      </div>
    );
  }
  if (item.field === 'description' && typeof item.output === 'string') {
    // Description is HTML — render it sanitised-style via prose so <p>/<ul>
    // come out properly. Output already comes from kie limited to outputCap
    // but truncate defensively for very long descriptions.
    const html = item.output.length > PAST_GEN_DETAIL_LIMIT * 4
      ? `${item.output.slice(0, PAST_GEN_DETAIL_LIMIT * 4)}…`
      : item.output;
    return (
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-xs"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  if (typeof item.output === 'string') {
    return (
      <p className="whitespace-pre-wrap break-words text-[var(--foreground)]">
        {item.output.length > PAST_GEN_DETAIL_LIMIT
          ? `${item.output.slice(0, PAST_GEN_DETAIL_LIMIT).trimEnd()}…`
          : item.output}
      </p>
    );
  }
  return <p className="text-[var(--muted)] italic">—</p>;
}

function ScoreBadge({ score }: { score: number }) {
  const accent =
    score >= 75
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : score >= 50
        ? 'bg-[var(--warning)]/10 text-[var(--warning)]'
        : 'bg-[var(--danger)]/10 text-[var(--danger)]';
  return (
    <span className={`text-sm font-mono px-3 py-1 rounded-full font-semibold ${accent}`}>
      {score}/100
    </span>
  );
}

function stripHtmlPreview(raw: string, max: number): string {
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function BackArrow() {
  return <ChevronLeft className="size-4" aria-hidden />;
}

