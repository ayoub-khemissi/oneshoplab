import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ImageZoom, ProductImageGallery } from '@/shared/ui';
import { RemoveBgSourceButton } from '@/features/generate-product-images';
import type { ProductImage, ProductSnapshot } from '../api/load-product';

export function SourcePreview({ product }: { product: ProductSnapshot }) {
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
            <h3 className="font-semibold leading-tight line-clamp-2">{product.title}</h3>
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

interface SourceImageGridProps {
  images: ProductImage[];
  /** When set, each original gets a "transparent background" action whose
   *  result lands in the AI grid. Omitted on read-only renders (tour demo). */
  removeBg?: { siteId: string; productId: string; cost: number };
}

export function SourceImageGrid({ images, removeBg }: SourceImageGridProps) {
  const t = useTranslations('Report');
  if (images.length === 0) {
    return <p className="text-sm text-[var(--muted)] italic">{t('aiNoImage')}</p>;
  }
  const cols =
    images.length === 1 ? 'grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-3';
  return (
    <div className={`grid gap-2 ${cols}`}>
      {images.map((img, i) => (
        <div key={`${img.src}-${i}`} className="flex flex-col gap-1.5 min-w-0">
          <ImageZoom url={img.src} alt={img.alt ?? ''} downloadName={`source-${i + 1}.jpg`} />
          {removeBg && /^https:\/\//i.test(img.src) ? (
            <RemoveBgSourceButton
              siteId={removeBg.siteId}
              productId={removeBg.productId}
              sourceImageUrl={img.src}
              cost={removeBg.cost}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
