'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// Built by remotion-promo (`pnpm hero:audio && pnpm hero`, then copy out/hero/hero-* to public/videos).
const DESKTOP_QUERY = '(min-width: 1024px)';

interface HeroVideoProps {
  label: string;
  soundOnLabel: string;
  soundOffLabel: string;
}

/**
 * The hero's story loop. Browsers only autoplay muted video, so it starts
 * muted with a sound toggle; it pauses off-screen and stays on its poster
 * for visitors who asked for reduced motion.
 */
export function HeroVideo({ label, soundOnLabel, soundOffLabel }: HeroVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // play() rejects when the browser blocks it; the poster stays up, which is fine.
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  function toggleSound() {
    const video = ref.current;
    if (!video) return;
    const next = !muted;
    video.muted = next;
    setMuted(next);
    // Turning the sound on from the middle of the story loses the setup; start over.
    if (!next) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  }

  return (
    <div className="relative w-full aspect-[4/5] lg:aspect-[16/10] rounded-2xl lg:rounded-3xl overflow-hidden border border-[var(--border)] bg-[var(--surface)] shadow-[0_40px_120px_-40px_oklch(0.4_0.19_250/0.45),0_12px_40px_-24px_oklch(0.2_0.02_250/0.35)]">
      {/* Poster underneath: the right crop per breakpoint, visible until the first frame. */}
      <picture>
        <source media={DESKTOP_QUERY} srcSet="/videos/hero-desktop-poster.webp" />
        <img
          src="/videos/hero-mobile-poster.webp"
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover"
        />
      </picture>
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={label}
        className="absolute inset-0 size-full object-cover"
      >
        <source src="/videos/hero-desktop.mp4" type="video/mp4" media={DESKTOP_QUERY} />
        <source src="/videos/hero-mobile.mp4" type="video/mp4" />
      </video>
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={!muted}
        className="absolute top-3 right-3 lg:top-4 lg:right-4 inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium backdrop-blur-md bg-[oklch(0.18_0.022_250/0.55)] text-white border border-white/15 hover:bg-[oklch(0.18_0.022_250/0.7)] transition-colors"
      >
        {muted ? (
          <VolumeX className="size-4" aria-hidden />
        ) : (
          <Volume2 className="size-4" aria-hidden />
        )}
        {muted ? soundOnLabel : soundOffLabel}
      </button>
    </div>
  );
}
