import { Card } from '@heroui/react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { loadHomeShowcaseCards, type HomeShowcaseCard } from '@/lib/share/queries';

/**
 * Public showcase strip on the landing page. Each card surfaces one
 * admin-curated case study — driven by share_links.show_on_home
 * (replaces the legacy SHOWCASE_PROJECT_IDS env var). The section
 * self-hides when no link is flagged for the home so the marketing
 * page doesn't render an empty section.
 *
 * Per card: clickable site domain (external-link badge), the two
 * featured products' before/after side-by-side, and a CTA that opens
 * the full /share/[token] case-study page.
 */
export async function ShowcaseSection() {
  const cards = await loadHomeShowcaseCards();
  if (cards.length === 0) return null;

  const t = await getTranslations('Showcase');

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
      <div className="grid md:grid-cols-2 gap-4">
        {cards.map((card) => (
          <ShowcaseCard
            key={card.token}
            card={card}
            sourceLabel={t('sourceLabel')}
            aiLabel={t('aiLabel')}
            viewLabel={t('viewReport')}
          />
        ))}
      </div>
    </section>
  );
}

function ShowcaseCard({
  card,
  sourceLabel,
  aiLabel,
  viewLabel
}: {
  card: HomeShowcaseCard;
  sourceLabel: string;
  aiLabel: string;
  viewLabel: string;
}) {
  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-4">
      {/* Header — clickable domain --------------------------------- */}
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

      {/* Two product before/after rows ----------------------------- */}
      <div className="flex flex-col gap-3">
        {card.products.map((p, i) => (
          <ProductRow
            key={p.sourceId}
            index={i + 1}
            product={p}
            sourceLabel={sourceLabel}
            aiLabel={aiLabel}
          />
        ))}
      </div>

      {/* CTA to full case study ------------------------------------ */}
      <Link
        href={`/share/${card.token}`}
        className="mt-1 self-start text-xs font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
      >
        {viewLabel}
        <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}

function ProductRow({
  index,
  product,
  sourceLabel,
  aiLabel
}: {
  index: number;
  product: HomeShowcaseCard['products'][number];
  sourceLabel: string;
  aiLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-md bg-[var(--default)]/40 border border-[var(--border)]">
      <span className="text-[10px] uppercase tracking-wider font-mono text-[var(--muted)]">
        #{index}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <Tile
          src={product.sourceImage}
          title={product.sourceTitle}
          label={sourceLabel}
          tone="muted"
        />
        <Tile
          src={product.aiImage}
          title={product.aiTitle ?? product.sourceTitle}
          label={aiLabel}
          tone="accent"
        />
      </div>
      {product.aiTitle ? (
        <div className="flex flex-col gap-0.5 text-xs">
          <p className="text-[var(--muted)] line-clamp-1">
            <span className="font-mono uppercase tracking-wider mr-1.5 text-[10px]">
              {sourceLabel}:
            </span>
            {product.sourceTitle}
          </p>
          <p className="font-medium line-clamp-1">
            <span className="font-mono uppercase tracking-wider mr-1.5 text-[10px] text-[var(--accent)]">
              {aiLabel}:
            </span>
            {product.aiTitle}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Tile({
  src,
  title,
  label,
  tone
}: {
  src: string | null;
  title: string;
  label: string;
  tone: 'muted' | 'accent';
}) {
  return (
    <div className="aspect-square rounded-md overflow-hidden relative bg-[var(--default)]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-[var(--muted)]">
          —
        </div>
      )}
      <span
        className={`absolute top-1.5 left-1.5 text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded font-semibold ${
          tone === 'accent'
            ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
            : 'bg-black/60 text-white'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
