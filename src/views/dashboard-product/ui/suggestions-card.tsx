import { Card } from '@heroui/react';
import { getTranslations } from 'next-intl/server';
import { AiImageGridLive } from '@/features/generate-product-images';
import { ApplyAiButton } from '@/features/manual-catalog';
import {
  CopyButton,
  DownloadAllButton,
  FieldSwap,
  FieldSwapGroup,
  FieldSwapGroupToggle,
  InfoHint,
  TagPills
} from '@/shared/ui';
import type { ProductSnapshot } from '../api/load-product';
import { RetryableGenerateButton } from '@/features/retryable-generate';
import type { ImageJobRow, OptimHistoryItem } from '@/entities/generation-job';
import { ApplyToStoreButton, type ChangeSummary } from '@/features/apply-to-store';
import { FieldRow, NoLatestGen } from './field-row';
import { SourcePreview, SourceImageGrid } from './source-preview';

interface SuggestionsCardProps {
  siteId: string;
  productId: string;
  projectId: string;
  product: ProductSnapshot;
  archived: boolean;
  isManual: boolean;
  hasHistory: { title: boolean; description: boolean; tags: boolean; images: boolean };
  hasCompletedImages: boolean;
  hasAnyHistory: boolean;
  titleHistory: OptimHistoryItem[];
  descriptionHistory: OptimHistoryItem[];
  tagsHistory: OptimHistoryItem[];
  liveImageJobs: ImageJobRow[];
  costPerImage: number;
  retentionDays: number;
  /** Apply-to-store state of the latest generation of each field. */
  changeByJobId: Record<string, ChangeSummary>;
  canApplyToStore: boolean;
}

export async function SuggestionsCard({
  siteId,
  productId,
  projectId,
  product,
  archived,
  isManual,
  hasHistory,
  hasCompletedImages,
  hasAnyHistory,
  titleHistory,
  descriptionHistory,
  tagsHistory,
  liveImageJobs,
  costPerImage,
  retentionDays,
  changeByJobId,
  canApplyToStore
}: SuggestionsCardProps) {
  const tReport = await getTranslations('Report');

  /** The send button for a field's newest generation, or nothing when there
   *  is none to send. */
  const applyFor = (history: OptimHistoryItem[], field: 'title' | 'description' | 'tags') => {
    const latest = history[0];
    if (!latest) return null;
    return (
      <ApplyToStoreButton
        key={changeByJobId[latest.jobId]?.status ?? 'none'}
        jobId={latest.jobId}
        siteId={siteId}
        initialChange={changeByJobId[latest.jobId] ?? null}
        canApplyToStore={canApplyToStore}
        disabled={archived}
        field={field}
      />
    );
  };

  return (
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

            <FieldRow
              field="title"
              hasHistory={hasHistory.title}
              apply={applyFor(titleHistory, 'title')}
            >
              <FieldSwap
                label={{
                  source: tReport('sourceTitleLabel'),
                  ai: tReport('aiTitle')
                }}
                labelHint={<InfoHint topic="title" label={tReport('sourceTitleLabel')} />}
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
                source={<p className="text-sm text-[var(--muted)]">{product.title || '—'}</p>}
                ai={
                  titleHistory[0] && typeof titleHistory[0].output === 'string' ? (
                    <p className="font-semibold">{titleHistory[0].output}</p>
                  ) : (
                    <NoLatestGen />
                  )
                }
              />
            </FieldRow>

            <FieldRow
              field="description"
              hasHistory={hasHistory.description}
              apply={applyFor(descriptionHistory, 'description')}
            >
              <FieldSwap
                label={{
                  source: tReport('sourceDescriptionLabel'),
                  ai: tReport('aiDescription')
                }}
                labelHint={
                  <InfoHint topic="description" label={tReport('sourceDescriptionLabel')} />
                }
                sourceLabel={tReport('swapSource')}
                aiLabel={tReport('swapAi')}
                aiAction={
                  descriptionHistory[0] && typeof descriptionHistory[0].output === 'string' ? (
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
                  descriptionHistory[0] && typeof descriptionHistory[0].output === 'string' ? (
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

            <FieldRow
              field="tags"
              hasHistory={hasHistory.tags}
              apply={applyFor(tagsHistory, 'tags')}
            >
              <FieldSwap
                label={{
                  source: tReport('sourceTagsLabel'),
                  ai: tReport('aiTags')
                }}
                labelHint={<InfoHint topic="tags" label={tReport('sourceTagsLabel')} />}
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
                labelHint={<InfoHint topic="images" label={tReport('sourceImagesLabel')} />}
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
  );
}
