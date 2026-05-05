import { Card } from '@heroui/react';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { ChevronLeft, ExternalLink } from 'lucide-react';
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
  FieldSwapGroupToggle
} from '@/components/field-swap';
import { ImageZoom } from '@/components/image-zoom';
import { ProductImageGallery } from '@/components/product-image-gallery';
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_QUALITY,
  listOptimHistory,
  type ChatModelId,
  type ImageQualityId,
  type OptimHistoryItem
} from '@/lib/ai';
import { auth } from '@/lib/auth';
import { touchProjectLastView } from '@/lib/auth-actions';
import { InsufficientCreditsError } from '@/lib/credits';
import { db } from '@/lib/db';
import { audits, products, projects } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; siteId: string }>;
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

async function loadProductForUser(
  userId: string,
  siteId: string,
  productId: string
): Promise<{ projectId: string; product: ProductSnapshot } | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.id, siteId))
  });
  if (!project) return null;

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, project.id)),
    columns: { sourceId: true, handle: true }
  });
  if (!productRow) return null;

  const audit = await db.query.audits.findFirst({
    where: or(
      eq(audits.projectId, project.id),
      and(isNull(audits.projectId), eq(audits.domain, project.domain ?? ''))
    ),
    orderBy: [desc(audits.createdAt)]
  });
  if (!audit?.summary) return null;

  const summary = audit.summary as SummaryShape;
  const all = [
    ...(summary.allProducts ?? []),
    ...(summary.worstProducts ?? []),
    ...(summary.latestProducts ?? []),
    ...(summary.bestProducts ?? [])
  ];
  // Snapshot in audit.summary is keyed by sourceId/handle (denormalized);
  // we resolved the URL's productId to those keys via the products table
  // above so the lookup is unambiguous regardless of slug content.
  const product = all.find((p) => {
    if (productRow.sourceId && p.sourceId === productRow.sourceId) return true;
    if (productRow.handle && p.handle === productRow.handle) return true;
    return false;
  });
  return product ? { projectId: project.id, product } : null;
}

// ============================================================================
// Page
// ============================================================================

export default async function ProductDetailPage({ params }: PageProps) {
  const { id: productId, siteId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const loaded = await loadProductForUser(session.user.id, siteId, productId);
  if (!loaded) notFound();
  const { product, projectId } = loaded;
  // sourceId is the audit-summary key for this product; needed for history
  // lookups and as the form payload key for AI generation jobs.
  const sourceId = product.sourceId ?? product.handle ?? '';

  // Mark this project as the user's most recently consulted store so the
  // dashboard auto-picks it on next visit.
  await touchProjectLastView(projectId);

  const [titleHistory, descriptionHistory, tagsHistory, imagesHistory] = await Promise.all([
    listOptimHistory(projectId, sourceId, 'title'),
    listOptimHistory(projectId, sourceId, 'description'),
    listOptimHistory(projectId, sourceId, 'tags'),
    listOptimHistory(projectId, sourceId, 'images')
  ]);

  // Drive the Generate vs Regenerate label: a field with at least one prior
  // AI output flips its CTA to "Regenerate" so the user understands they're
  // overwriting / appending rather than first-time generating.
  const hasHistory = {
    title: titleHistory.length > 0,
    description: descriptionHistory.length > 0,
    tags: tagsHistory.length > 0,
    images: imagesHistory.length > 0
  };
  const hasAnyHistory =
    hasHistory.title || hasHistory.description || hasHistory.tags || hasHistory.images;

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

  return (
    <main className="flex-1 p-6 md:p-10 max-w-5xl w-full mx-auto flex flex-col gap-6">
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
          <span className="text-sm text-[var(--muted)] font-mono">
            {t('creditsBalance', { balance })}
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

      <RetryableGenerateProvider
        siteId={siteId}
        productId={productId}
        initialChatModelId={userChatModel}
        initialImageQualityId={userImageQuality}
        creditsBalance={balance}
      >
        <div className="flex flex-col gap-6">
        <ModelChips />
        <CustomInstructionsField />

        <Card variant="secondary" className="overflow-hidden">
          <div className="grid md:grid-cols-[260px_1fr]">
            <SourcePreview product={product} />

            <FieldSwapGroup>
              <div className="px-5 flex flex-col gap-5 border-t md:border-t-0 md:border-l border-[var(--border)]">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="eyebrow">AI suggestions</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <RetryableGenerateButton field="all" hasHistory={hasAnyHistory} />
                    <FieldSwapGroupToggle
                      sourceLabel={tReport('swapSource')}
                      aiLabel={tReport('swapAi')}
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
                        <CopyButton
                          value={descriptionHistory[0].output as string}
                          asHtml
                          label={tReport('copyHtml')}
                          copiedLabel={tReport('copied')}
                        />
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
                    aiAction={
                      tagsHistory[0] && Array.isArray(tagsHistory[0].output) ? (
                        <CopyButton
                          value={tagsHistory[0].output.join(', ')}
                          label={tReport('copyTags')}
                          copiedLabel={tReport('copied')}
                        />
                      ) : null
                    }
                    source={<TagPills tags={product.signals.tags ?? []} variant="muted" />}
                    ai={
                      tagsHistory[0] && Array.isArray(tagsHistory[0].output) ? (
                        <TagPills tags={tagsHistory[0].output} variant="accent" />
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
                      const aiUrls = imagesHistory
                        .flatMap((h) => (Array.isArray(h.output) ? h.output : [h.output]))
                        .filter(
                          (u): u is string => typeof u === 'string' && u.length > 0
                        )
                        .slice(0, 3);
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
                    ai={<AiImageGrid history={imagesHistory} />}
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
        items={[...titleHistory, ...descriptionHistory, ...tagsHistory, ...imagesHistory].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        )}
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
  );
}

function NoLatestGen() {
  const t = useTranslations('Product');
  return <p className="text-sm text-[var(--muted)] italic">{t('noLatestGeneration')}</p>;
}

function TagPills({
  tags,
  variant
}: {
  tags: string[];
  variant: 'muted' | 'accent';
}) {
  if (tags.length === 0) {
    return <p className="text-sm text-[var(--muted)] italic">—</p>;
  }
  const pillClass =
    variant === 'accent'
      ? 'text-xs px-2 py-1 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
      : 'text-xs px-2 py-1 rounded bg-[var(--default)] text-[var(--muted)]';
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag, i) => (
        <span key={`${variant}-${tag}-${i}`} className={pillClass}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function SourcePreview({ product }: { product: ProductSnapshot }) {
  const t = useTranslations('Report');
  const description = product.descriptionHtml
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const descriptionExcerpt =
    description.length > 160 ? `${description.slice(0, 160)}…` : description;

  return (
    <div className="bg-[var(--default)] flex flex-col">
      <ProductImageGallery
        images={product.images.map((i) => ({ src: i.src, alt: i.alt }))}
        emptyLabel={t('aiNoImage')}
      />
      <div className="p-4 flex flex-col gap-2">
        <span className="eyebrow">{t('aiSourceLabel')}</span>
        <h3 className="font-semibold leading-tight line-clamp-2">{product.title}</h3>
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

function AiImageGrid({ history }: { history: OptimHistoryItem[] }) {
  const t = useTranslations('Product');
  // Take the most recent batch — group by ~recent generation. For simplicity
  // we display the 3 latest result URLs across all completed image jobs.
  const urls = history
    .flatMap((h) => (Array.isArray(h.output) ? h.output : [h.output]))
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .slice(0, 3);

  if (urls.length === 0) {
    return <p className="text-sm text-[var(--muted)] italic">{t('noLatestGeneration')}</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {urls.map((u, i) => (
        <ImageZoom
          key={`${u}-${i}`}
          url={u}
          alt="Generated"
          downloadName={`ai-${i + 1}.png`}
        />
      ))}
    </div>
  );
}

function PastGenerationsSection({
  title,
  emptyText,
  items
}: {
  title: string;
  emptyText: string;
  items: OptimHistoryItem[];
}) {
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
        <ul className="divide-y divide-[var(--border)]">
          {items.slice(0, 30).map((h) => (
            <li
              key={h.jobId}
              className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-mono shrink-0 w-20">
                  {h.field}
                </span>
                <span className="truncate">
                  {Array.isArray(h.output)
                    ? `${h.output.length} item(s)`
                    : typeof h.output === 'string'
                      ? stripHtmlPreview(h.output, 80)
                      : ''}
                </span>
              </div>
              <span className="text-xs text-[var(--muted)] font-mono shrink-0">
                {h.createdAt.toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
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

