import { Card } from '@heroui/react';
import { ArrowRight, ExternalLink, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ProductImageGallery } from '@/components/product-image-gallery';
import { loadHomeShowcaseCards, type HomeShowcaseCard } from '@/lib/share/queries';

/**
 * Public showcase strip on the landing page. Each card surfaces one
 * admin-curated case study — driven by share_links.show_on_home
 * (replaces the legacy SHOWCASE_PROJECT_IDS env var). The section
 * self-hides when no link is flagged so the marketing page doesn't
 * render an empty slot.
 *
 * Card layout (per product on the home, full card width):
 *   - title before / after side-by-side at the top
 *   - left: source-images carousel + AI-images carousel
 *   - right: description before/after (truncated) + tags before/after
 *   On mobile every column stacks naturally (single column).
 *
 * A primary-styled "Consulter le rapport complet" button at the
 * bottom-right of each card opens the full /share/{token} page.
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
      {/* Full-width cards, one per share link — stacked vertically. */}
      <div className="flex flex-col gap-6">
        {cards.map((card) => (
          <ShowcaseCard
            key={card.token}
            card={card}
            labels={{
              source: t('sourceLabel'),
              ai: t('aiLabel'),
              view: t('viewReport'),
              description: tShare('fieldDescription'),
              tags: tShare('fieldTags'),
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
  description: string;
  tags: string;
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

      {/* One block per featured product ---------------------------- */}
      <div className="flex flex-col gap-5 divide-y divide-[var(--border)]">
        {card.products.map((p, i) => (
          <ProductBlock
            key={p.sourceId}
            index={i + 1}
            product={p}
            labels={labels}
            firstChild={i === 0}
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

function ProductBlock({
  index,
  product,
  labels,
  firstChild
}: {
  index: number;
  product: HomeShowcaseCard['products'][number];
  labels: ShowcaseLabels;
  firstChild: boolean;
}) {
  const sourceText = product.sourceDescriptionHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const aiText = (product.aiDescriptionHtml ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className={`flex flex-col gap-4 ${firstChild ? '' : 'pt-5'}`}>
      <span className="text-[10px] uppercase tracking-wider font-mono text-[var(--muted)]">
        #{index}
      </span>

      {/* Title — before / after side by side (stack on mobile) ----- */}
      <div className="grid md:grid-cols-2 gap-3 p-3 rounded-md bg-[var(--default)]/40 border border-[var(--border)]">
        <TitleColumn
          label={labels.source}
          title={product.sourceTitle}
          tone="muted"
        />
        <TitleColumn
          label={labels.ai}
          title={product.aiTitle}
          fallback={labels.noTitle}
          tone="accent"
        />
      </div>

      {/* Body grid: image carousels (2/3) + sidebar text (1/3) ------ */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Carousels — span 2 cols on desktop --------------------- */}
        <div className="md:col-span-2 grid sm:grid-cols-2 gap-3">
          <GalleryColumn
            label={labels.source}
            images={product.sourceImages}
            emptyLabel={labels.noImages}
            tone="muted"
          />
          <GalleryColumn
            label={labels.ai}
            images={product.aiImages}
            emptyLabel={labels.noImages}
            tone="accent"
          />
        </div>

        {/* Sidebar: description + tags ---------------------------- */}
        <aside className="flex flex-col gap-3">
          <TextPair
            heading={labels.description}
            sourceLabel={labels.source}
            aiLabel={labels.ai}
            sourceText={sourceText}
            aiText={aiText}
            empty={labels.noDescription}
          />
          <TagsPair
            heading={labels.tags}
            sourceLabel={labels.source}
            aiLabel={labels.ai}
            sourceTags={product.sourceTags}
            aiTags={product.aiTags}
            empty={labels.noTags}
          />
        </aside>
      </div>
    </div>
  );
}

function TitleColumn({
  label,
  title,
  fallback,
  tone
}: {
  label: string;
  title: string | null;
  fallback?: string;
  tone: 'muted' | 'accent';
}) {
  const showsFallback = !title || !title.trim();
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`text-[10px] uppercase tracking-wider font-mono inline-flex items-center gap-1 ${
          tone === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
        }`}
      >
        {label}
        {tone === 'accent' ? <Sparkles className="size-3" aria-hidden /> : null}
      </span>
      <p
        className={`text-sm md:text-base font-medium leading-relaxed line-clamp-2 ${
          showsFallback ? 'text-[var(--muted)] italic' : ''
        }`}
      >
        {showsFallback ? fallback ?? '' : title}
      </p>
    </div>
  );
}

function GalleryColumn({
  label,
  images,
  emptyLabel,
  tone
}: {
  label: string;
  images: Array<{ src: string; alt: string | null }>;
  emptyLabel: string;
  tone: 'muted' | 'accent';
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={`text-[10px] uppercase tracking-wider font-mono inline-flex items-center gap-1 ${
          tone === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
        }`}
      >
        {label}
        {tone === 'accent' ? <Sparkles className="size-3" aria-hidden /> : null}
      </span>
      <div className="rounded-md overflow-hidden border border-[var(--border)]">
        <ProductImageGallery
          images={images}
          aspect="aspect-square"
          emptyLabel={emptyLabel}
        />
      </div>
    </div>
  );
}

function TextPair({
  heading,
  sourceLabel,
  aiLabel,
  sourceText,
  aiText,
  empty
}: {
  heading: string;
  sourceLabel: string;
  aiLabel: string;
  sourceText: string;
  aiText: string;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-mono uppercase tracking-wider text-[var(--muted)]">
        {heading}
      </span>
      <TextBlock label={sourceLabel} text={sourceText} empty={empty} tone="muted" />
      <TextBlock label={aiLabel} text={aiText} empty={empty} tone="accent" />
    </div>
  );
}

function TextBlock({
  label,
  text,
  empty,
  tone
}: {
  label: string;
  text: string;
  empty: string;
  tone: 'muted' | 'accent';
}) {
  const isEmpty = !text;
  return (
    <div
      className={`flex flex-col gap-1 p-2.5 rounded-md border ${
        tone === 'accent'
          ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5'
          : 'border-[var(--border)] bg-[var(--default)]/40'
      }`}
    >
      <span
        className={`text-[10px] uppercase tracking-wider font-mono inline-flex items-center gap-1 ${
          tone === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
        }`}
      >
        {label}
        {tone === 'accent' ? <Sparkles className="size-3" aria-hidden /> : null}
      </span>
      <p
        className={`text-xs leading-relaxed line-clamp-4 ${
          isEmpty ? 'text-[var(--muted)] italic' : ''
        }`}
      >
        {isEmpty ? empty : text}
      </p>
    </div>
  );
}

function TagsPair({
  heading,
  sourceLabel,
  aiLabel,
  sourceTags,
  aiTags,
  empty
}: {
  heading: string;
  sourceLabel: string;
  aiLabel: string;
  sourceTags: string[];
  aiTags: string[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-mono uppercase tracking-wider text-[var(--muted)]">
        {heading}
      </span>
      <TagsBlock label={sourceLabel} tags={sourceTags} empty={empty} tone="muted" />
      <TagsBlock label={aiLabel} tags={aiTags} empty={empty} tone="accent" />
    </div>
  );
}

function TagsBlock({
  label,
  tags,
  empty,
  tone
}: {
  label: string;
  tags: string[];
  empty: string;
  tone: 'muted' | 'accent';
}) {
  return (
    <div
      className={`flex flex-col gap-1 p-2.5 rounded-md border ${
        tone === 'accent'
          ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5'
          : 'border-[var(--border)] bg-[var(--default)]/40'
      }`}
    >
      <span
        className={`text-[10px] uppercase tracking-wider font-mono inline-flex items-center gap-1 ${
          tone === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
        }`}
      >
        {label}
        {tone === 'accent' ? <Sparkles className="size-3" aria-hidden /> : null}
      </span>
      {tags.length === 0 ? (
        <span className="text-xs text-[var(--muted)] italic">{empty}</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                tone === 'accent'
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                  : 'bg-[var(--default)] text-[var(--muted)]'
              }`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
