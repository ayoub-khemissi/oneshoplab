'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ProductImageGalleryProps {
  images: Array<{ src: string; alt: string | null }>;
  /** Aspect ratio for the main panel (Tailwind class). Default 4/5 portrait. */
  aspect?: string;
  /** Empty-state caption (used when product has no images). */
  emptyLabel: string;
}

/**
 * Compact gallery for the narrow product preview column. All images
 * live side-by-side in a horizontally scroll-snapping strip — that
 * gives mobile users a native swipe-to-paginate experience without
 * needing JavaScript-based touch handlers. Desktop users get
 * chevron buttons revealed on hover. Dot indicators and the index
 * counter sync to the live scroll position via a single scroll
 * listener so all three controls always agree on which image is
 * "current". Keyboard arrows scroll the container too.
 */
export function ProductImageGallery({
  images,
  aspect = 'aspect-[4/5]',
  emptyLabel
}: ProductImageGalleryProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const total = images.length;

  // Compute the active index from scrollLeft. Rounded so a mid-snap
  // pause still picks a winner. Cheap enough to run on every scroll
  // event without rAF batching.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || total === 0) return;
    const onScroll = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      const i = Math.min(total - 1, Math.max(0, Math.round(el.scrollLeft / w)));
      setIndex(i);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [total]);

  // Keyboard arrow support — scrolls the container so the snap +
  // dot logic stays unified with the touch / chevron paths.
  useEffect(() => {
    if (total === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') scrollToIndex((index - 1 + total) % total);
      if (e.key === 'ArrowRight') scrollToIndex((index + 1) % total);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total]);

  function scrollToIndex(i: number): void {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }

  if (total === 0) {
    return (
      <div
        className={`${aspect} w-full flex items-center justify-center text-xs text-[var(--muted)] bg-[var(--default)]`}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={`${aspect} relative overflow-hidden bg-[var(--default)] group`}>
      <div
        ref={scrollRef}
        className="absolute inset-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((img, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${img.src}-${i}`}
            src={img.src}
            alt={img.alt ?? ''}
            // `scroll-snap-stop: always` is the Instagram-style "one
            // swipe = one image" — without it, a fast swipe carries
            // momentum across multiple snap points and the gallery
            // skips. The arbitrary-value Tailwind class compiles to
            // the raw CSS property since the utility isn't shipped
            // by default.
            className="w-full h-full flex-shrink-0 snap-center [scroll-snap-stop:always] object-cover"
            loading={i === 0 ? 'eager' : 'lazy'}
            draggable={false}
          />
        ))}
      </div>

      {total > 1 ? (
        <>
          {/* Desktop chevrons — hidden on touch viewports since native
              swipe handles navigation there, and a perma-visible button
              row would crowd the 260px preview column. */}
          <button
            type="button"
            onClick={() => scrollToIndex((index - 1 + total) % total)}
            aria-label="Previous image"
            className="hidden md:flex absolute left-1.5 top-1/2 -translate-y-1/2 size-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm items-center justify-center text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollToIndex((index + 1) % total)}
            aria-label="Next image"
            className="hidden md:flex absolute right-1.5 top-1/2 -translate-y-1/2 size-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm items-center justify-center text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <ChevronRight className="size-4" />
          </button>

          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 backdrop-blur-sm pointer-events-auto">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollToIndex(i)}
                aria-label={`Image ${i + 1}`}
                aria-current={i === index ? 'true' : undefined}
                className={`size-1.5 rounded-full transition-all ${
                  i === index ? 'bg-white w-4' : 'bg-white/50 hover:bg-white/80'
                }`}
              />
            ))}
          </div>

          <span className="absolute top-1.5 right-1.5 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/50 text-white pointer-events-none">
            {index + 1}/{total}
          </span>
        </>
      ) : null}
    </div>
  );
}
