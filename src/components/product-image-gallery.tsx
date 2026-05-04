'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ProductImageGalleryProps {
  images: Array<{ src: string; alt: string | null }>;
  /** Aspect ratio for the main panel (Tailwind class). Default 4/5 portrait. */
  aspect?: string;
  /** Empty-state caption (used when product has no images). */
  emptyLabel: string;
}

/**
 * Compact gallery for narrow preview columns: one image visible, prev/next
 * chevrons revealed on hover, dot indicator below. Keyboard arrows also
 * navigate when the gallery has focus. No modal — kept flat to fit the
 * 260px sidebar of the product detail page.
 */
export function ProductImageGallery({
  images,
  aspect = 'aspect-[4/5]',
  emptyLabel
}: ProductImageGalleryProps) {
  const [index, setIndex] = useState(0);
  const total = images.length;
  const safe = total > 0 ? Math.min(index, total - 1) : 0;

  useEffect(() => {
    if (total === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + total) % total);
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % total);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [total]);

  if (total === 0) {
    return (
      <div
        className={`${aspect} w-full flex items-center justify-center text-xs text-[var(--muted)] bg-[var(--default)]`}
      >
        {emptyLabel}
      </div>
    );
  }

  const current = images[safe];

  return (
    <div className={`${aspect} relative overflow-hidden bg-[var(--default)] group`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.src}
        alt={current.alt ?? ''}
        className="w-full h-full object-cover"
        loading="lazy"
      />

      {total > 1 ? (
        <>
          <button
            type="button"
            onClick={() => setIndex((i) => (i - 1 + total) % total)}
            aria-label="Previous image"
            className="absolute left-1.5 top-1/2 -translate-y-1/2 size-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => (i + 1) % total)}
            aria-label="Next image"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 size-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <ChevronRight className="size-4" />
          </button>

          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 backdrop-blur-sm">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Image ${i + 1}`}
                aria-current={i === safe ? 'true' : undefined}
                className={`size-1.5 rounded-full transition-all ${
                  i === safe ? 'bg-white w-4' : 'bg-white/50 hover:bg-white/80'
                }`}
              />
            ))}
          </div>

          <span className="absolute top-1.5 right-1.5 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/50 text-white">
            {safe + 1}/{total}
          </span>
        </>
      ) : null}
    </div>
  );
}
