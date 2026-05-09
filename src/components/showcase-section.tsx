import { Card } from '@heroui/react';
import { ArrowRight, ExternalLink, ImageIcon, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ImageZoom } from '@/components/image-zoom';
import { loadHomeShowcaseCards, type HomeShowcaseCard } from '@/lib/share/queries';

/**
 * Public showcase strip on the landing page. Each card surfaces one
 * admin-curated case study — driven by share_links.show_on_home
 * (replaces the legacy SHOWCASE_PROJECT_IDS env var). The section
 * self-hides when no link is flagged so the marketing page doesn't
 * render an empty slot.
 *
 * Per-product layout mirrors the /share/[token] case-study page,
 * deliberately compact (smaller paddings + 4-up image strip instead
 * of full-size zoom panels) so a homepage card with two products
 * stays readable at one glance.
 */
export async function ShowcaseSection() {
  const cards = await loadHomeShowcaseCards();
  if (cards.length === 0) return null;

  const t = await getTranslations('Showcase');
  const tShare = await getTranslations('Share');

  return (
    <section className="relative z-10 max-w-6xl w-full mx-auto px-6 py-16 md:py-20 flex flex-col gap-8">
      <header className="flex flex-col items-center text-center gap-2 max-w-2xl mx-auto">
        <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)] font-mono">
          {t('eyebrow')}
        </span>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('title')}</h2>
        <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed">
          {t('subtitle')}
        </p>
      </header>
      <div className="flex flex-col gap-6">
        {cards.map((card) => (
          <ShowcaseCard
            key={card.token}
            card={card}
            labels={{
              source: t('sourceLabel'),
              ai: t('aiLabel'),
              view: t('viewReport'),
              title: tShare('fieldTitle'),
              description: tShare('fieldDescription'),
              tags: tShare('fieldTags'),
              images: tShare('fieldImages'),
              noTitle: tShare('noTitle'),
              noDescription: tShare('noDescription'),
              noTags: tShare('noTags'),
              noImages: tShare('noImages')
            }}
          />
        ))}
      </div>
    </section>
  );
}

interface ShowcaseLabels {
  source: string;
  ai: string;
  view: string;
  title: string;
  description: string;
  tags: string;
  images: string;
  noTitle: string;
  noDescription: string;
  noTags: string;
  noImages: string;
}

function ShowcaseCard({
  card,
  labels
}: {
  card: HomeShowcaseCard;
  labels: ShowcaseLabels;
}) {
  return (
    <Card variant="secondary" className="p-5 md:p-6 flex flex-col gap-5 w-full">
      {/* Header — clickable storefront domain ---------------------- */}
      <a
        href={card.siteUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="self-start inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)] hover:text-[var(--accent)] transition-colors group/domain"
      >
        <span className="font-mono">{card.domain}</span>
        <ExternalLink
          className="size-3.5 opacity-50 group-hover/domain:opacity-100 transition-opacity shrink-0"
          aria-hidden
        />
      </a>

      {/* One ProductCaseStudy block per featured product. The blocks
          share the same shape as /share/[token] but with smaller
          paddings and a 4-image-up grid instead of full-zoom tiles. */}
      <div className="flex flex-col gap-5">
        {card.products.map((p, i) => (
          <ProductCaseStudy
            key={p.sourceId}
            index={i + 1}
            product={p}
            fallbackUrl={card.siteUrl}
            labels={labels}
          />
        ))}
      </div>

      {/* Primary CTA: bottom-right -------------------------------- */}
      <div className="flex justify-end mt-auto pt-1">
        <Link
          href={`/share/${card.token}`}
          className="px-3 py-1.5 text-sm rounded-md whitespace-nowrap font-medium inline-flex items-center gap-1.5 transition-opacity bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90"
        >
          {labels.view}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </Card>
  );
}

/**
 * Compact version of the share page's ProductCaseStudy. Same Source
 * vs AI two-column structure (Title / Description / Tags / Images);
 * the only delta is tighter typography + image grid so a homepage
 * card hosting two of these doesn't blow past the fold.
 *
 * Header line is a clickable link to the merchant's storefront page
 * for this specific product (productUrl), with an external-link
 * badge that opacifies on hover — same pattern as the /share/[token]
 * domain header.
 */
function ProductCaseStudy({
  index,
  product,
  fallbackUrl,
  labels
}: {
  index: number;
  product: HomeShowcaseCard['products'][number];
  /** Used when the audit summary didn't capture a product-specific
   *  URL — at least the storefront opens. */
  fallbackUrl: string;
  labels: ShowcaseLabels;
}) {
  const sourceText =
    product.sourceDescriptionHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || labels.noDescription;
  const aiText = (product.aiDescriptionHtml ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const productHref = product.productUrl ?? fallbackUrl;

  return (
    <div className="flex flex-col gap-4 p-4 rounded-md bg-[var(--default)]/30 border border-[var(--border)]">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <a
          href={productHref}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 hover:text-[var(--accent)] transition-colors group/title"
        >
          <h3 className="text-base md:text-lg font-bold tracking-tight">
            <span className="text-[var(--muted)] mr-2">#{index}</span>
            {product.sourceTitle}
          </h3>
          <ExternalLink
            className="size-3.5 mt-0.5 shrink-0 opacity-50 group-hover/title:opacity-100 transition-opacity"
            aria-hidden
          />
        </a>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Source column ------------------------------------------- */}
        <div className="flex flex-col gap-2.5">
          <span className="eyebrow">{labels.source}</span>
          <Field label={labels.title} value={product.sourceTitle} muted={false} />
          <Field
            label={labels.description}
            value={sourceText}
            muted={!product.sourceDescriptionHtml}
            multiline
          />
          <Field
            label={labels.tags}
            value={
              product.sourceTags.length > 0
                ? product.sourceTags.join(', ')
                : labels.noTags
            }
            muted={product.sourceTags.length === 0}
          />
          <ImageRow
            label={labels.images}
            urls={product.sourceImages.map((i) => i.src)}
            emptyLabel={labels.noImages}
          />
        </div>

        {/* AI column ----------------------------------------------- */}
        <div className="flex flex-col gap-2.5">
          <span className="eyebrow inline-flex items-center gap-2">
            {labels.ai}
            <Sparkles className="size-3 text-[var(--accent)]" aria-hidden />
          </span>
          <Field
            label={labels.title}
            value={product.aiTitle ?? labels.noTitle}
            muted={!product.aiTitle}
          />
          <Field
            label={labels.description}
            value={aiText || labels.noDescription}
            muted={!aiText}
            multiline
          />
          <Field
            label={labels.tags}
            value={
              product.aiTags.length > 0 ? product.aiTags.join(', ') : labels.noTags
            }
            muted={product.aiTags.length === 0}
          />
          <ImageRow
            label={labels.images}
            urls={product.aiImages.map((i) => i.src)}
            emptyLabel={labels.noImages}
            ai
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  muted,
  multiline = false
}: {
  label: string;
  value: string;
  muted: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
        {label}
      </span>
      <p
        className={`text-xs leading-relaxed ${muted ? 'text-[var(--muted)] italic' : ''} ${
          multiline ? 'line-clamp-4' : 'line-clamp-2'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ImageRow({
  label,
  urls,
  emptyLabel,
  ai = false
}: {
  label: string;
  urls: string[];
  emptyLabel: string;
  ai?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] inline-flex items-center gap-1.5">
        {label}
        {ai ? <Sparkles className="size-3 text-[var(--accent)]" aria-hidden /> : null}
      </span>
      {urls.length === 0 ? (
        <div className="aspect-[4/1] rounded-md bg-[var(--default)]/40 border border-[var(--border)] flex items-center justify-center text-xs text-[var(--muted)] italic">
          <ImageIcon className="size-4 mr-1.5 shrink-0" aria-hidden />
          {emptyLabel}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {urls.slice(0, 3).map((url, i) => (
            <ImageZoom
              key={`${url}-${i}`}
              url={url}
              alt={ai ? 'AI generated' : 'Source product image'}
              downloadName={ai ? `ai-${i + 1}.png` : `source-${i + 1}.jpg`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
