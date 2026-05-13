'use client';

import { useState } from 'react';

interface SiteFaviconProps {
  domain: string | null | undefined;
  /** Rendered size in px. Default 16. Images are always fetched at 64px so
   *  scaling down stays sharp on hi-DPI screens regardless of `size`. */
  size?: number;
  className?: string;
}

/**
 * Favicon for a merchant's domain, with a 3-step fallback chain.
 *
 *   1. DuckDuckGo Icons (icons.duckduckgo.com)
 *      → Best accuracy and *fails 404 cleanly* when it doesn't know
 *        the domain, so the chain can advance. Picks up subdomains
 *        like `*.myshopify.com` that Google's index misses.
 *
 *   2. Direct `https://{domain}/favicon.ico`
 *      → Catches sites that serve a favicon at the canonical path.
 *        Browser handles the fetch; CORS doesn't apply to <img>.
 *
 *   3. Google S2 (google.com/s2/favicons)
 *      → Always returns something — even an unknown-domain "globe"
 *        glyph — so it's the safety net. If Google has the real
 *        icon, the previous two missed (rare), this still wins.
 *
 *   4. Letter avatar
 *      → Only reachable when all three image sources actually 4xx,
 *        which in practice means Google also failed — a near-zero
 *        case but the UI stays clean.
 *
 * Why the chain runs client-side: each step relies on the browser's
 * own `onerror` event to know whether the image actually loaded.
 * A server-side proxy could short-circuit this but would shift
 * bandwidth + caching onto our box for no real win — favicons are
 * tiny and the 3rd-party endpoints already CDN them aggressively.
 */
export function SiteFavicon({ domain, size = 16, className = '' }: SiteFaviconProps) {
  const [step, setStep] = useState(0);

  if (!domain) return null;
  const cleaned = domain.replace(/^https?:\/\//, '').split('/')[0].trim();
  if (!cleaned) return null;

  const sources = [
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(cleaned)}.ico`,
    `https://${cleaned}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleaned)}&sz=64`
  ];

  if (step >= sources.length) {
    return <LetterAvatar domain={cleaned} size={size} className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // Re-keyed on the source so React replaces the element rather
      // than reusing it with a new src — that way `onerror` fires
      // reliably across all browsers when the chain advances.
      key={sources[step]}
      src={sources[step]}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      loading="lazy"
      onError={() => setStep((s) => s + 1)}
    />
  );
}

function LetterAvatar({
  domain,
  size,
  className
}: {
  domain: string;
  size: number;
  className: string;
}) {
  const letter = domain[0]?.toUpperCase() ?? '?';
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className={`inline-flex items-center justify-center rounded bg-[var(--default)] text-[var(--muted)] font-semibold leading-none ${className}`}
      aria-hidden
    >
      {letter}
    </span>
  );
}
