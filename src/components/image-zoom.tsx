'use client';

import { Spinner } from '@heroui/react';
import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ImageZoomProps {
  url: string;
  alt?: string;
  /** Filename used when the user downloads (e.g. "lifestyle.png"). */
  downloadName?: string;
  /** Small label shown on hover at the bottom-left of the thumbnail. */
  angleLabel?: string;
  /** Small label shown on hover at the bottom-right of the thumbnail. */
  durationLabel?: string;
}

/**
 * Thumbnail with two interactions:
 *   - Click image → open full-screen modal (with backdrop, close button,
 *     download button top-right of the modal).
 *   - Click the small download button (top-right of the thumb, hover-only)
 *     → trigger a direct download without opening the modal.
 *
 * The outer wrapper is a `<div role="button">` rather than a `<button>` so we
 * can nest a real `<button>` inside (the hover download icon) without
 * producing invalid nested-interactive HTML.
 */
export function ImageZoom({
  url,
  alt = '',
  downloadName,
  angleLabel,
  durationLabel
}: ImageZoomProps) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [mounted, setMounted] = useState(false);

  // createPortal needs document.body, which only exists after hydration.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function downloadImage(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = downloadName ?? `image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // CORS or network error — fallback to opening in a new tab.
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="aspect-square rounded-md overflow-hidden bg-[var(--default)] block w-full cursor-zoom-in group relative focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        aria-label="Zoom image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />

        {/* Hover-only download icon (top-right). Click stops propagation so
            the modal doesn't open. */}
        <button
          type="button"
          onClick={downloadImage}
          disabled={downloading}
          className="absolute top-1.5 right-1.5 size-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
          aria-label="Download image"
          title="Download"
        >
          {downloading ? (
            <Spinner size="sm" className="text-white" />
          ) : (
            <Download className="size-3.5 text-white" />
          )}
        </button>

        {(angleLabel || durationLabel) && (
          <div className="absolute bottom-1 left-1 right-1 flex justify-between gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {angleLabel ? (
              <span className="text-[10px] uppercase tracking-wider bg-black/60 text-white px-1.5 py-0.5 rounded font-mono">
                {angleLabel}
              </span>
            ) : (
              <span />
            )}
            {durationLabel ? (
              <span className="text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded font-mono">
                {durationLabel}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Modal goes through a portal to <body> so it escapes any ancestor
          stacking context. HeroUI Card / our backdrop-blur wrappers create
          one via `transform`, `filter`, or `backdrop-filter` — without a
          portal, `fixed` would be containing-block-scoped to that parent
          and the modal would render *behind* sibling cards. z-[9999]
          keeps it above any popover or sticky header in the app shell. */}
      {open && mounted
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-8"
              onClick={() => setOpen(false)}
            >
              <button
                type="button"
                onClick={(e) => downloadImage(e)}
                disabled={downloading}
                className="absolute top-4 right-4 size-11 rounded-full bg-black/10 hover:bg-black/30 backdrop-blur-md transition-colors flex items-center justify-center disabled:opacity-50"
                aria-label="Download image"
                title="Download"
              >
                {downloading ? (
                  <Spinner size="md" className="text-white" />
                ) : (
                  <Download className="size-5 text-white" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute top-4 left-4 size-11 rounded-full bg-black/10 hover:bg-black/30 backdrop-blur-md transition-colors flex items-center justify-center"
                aria-label="Close"
              >
                <X className="size-5 text-white" />
              </button>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={alt}
                className="max-w-full max-h-full object-contain rounded shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

