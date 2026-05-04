'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ImageZoom } from './image-zoom';

export interface CarouselImage {
  url: string;
  alt?: string;
  downloadName?: string;
  /** Small label shown on hover at the bottom-left of the thumbnail. */
  angleLabel?: string;
  /** Small label shown on hover at the bottom-right of the thumbnail. */
  durationLabel?: string;
}

interface ImageCarouselProps {
  images: CarouselImage[];
  emptyLabel?: string;
}

/**
 * Horizontal scrollable carousel of image thumbnails. Each thumb opens the
 * zoom modal on click; arrow buttons (hover-revealed) scroll the strip ±~85%
 * of its width with smooth behaviour. Falls back to native touch scroll on
 * mobile where the buttons aren't visible.
 */
export function ImageCarousel({ images, emptyLabel }: ImageCarouselProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 4);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [images.length]);

  function scroll(dir: 'left' | 'right') {
    const el = ref.current;
    if (!el) return;
    const delta = el.clientWidth * 0.85 * (dir === 'right' ? 1 : -1);
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }

  if (images.length === 0) {
    return <p className="text-sm text-[var(--muted)] italic">{emptyLabel ?? '—'}</p>;
  }

  return (
    <div className="relative group">
      <div
        ref={ref}
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 scrollbar-hide"
      >
        {images.map((img, i) => (
          <div key={`${img.url}-${i}`} className="snap-start shrink-0 w-32 sm:w-40 md:w-44">
            <ImageZoom
              url={img.url}
              alt={img.alt ?? ''}
              downloadName={img.downloadName}
              angleLabel={img.angleLabel}
              durationLabel={img.durationLabel}
            />
          </div>
        ))}
      </div>
      {canLeft ? (
        <button
          type="button"
          onClick={() => scroll('left')}
          aria-label="Previous"
          className="absolute left-1 top-1/2 -translate-y-1/2 size-9 rounded-full bg-[var(--surface)]/95 border border-[var(--border)] backdrop-blur shadow-md flex items-center justify-center hover:bg-[var(--default)] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <ChevronLeft className="size-4" />
        </button>
      ) : null}
      {canRight ? (
        <button
          type="button"
          onClick={() => scroll('right')}
          aria-label="Next"
          className="absolute right-1 top-1/2 -translate-y-1/2 size-9 rounded-full bg-[var(--surface)]/95 border border-[var(--border)] backdrop-blur shadow-md flex items-center justify-center hover:bg-[var(--default)] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <ChevronRight className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
