'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface ScrollAwareStickyProps {
  children: ReactNode;
  /** Distance (px) from the top of the viewport where the bar sticks. */
  topOffsetPx: number;
  /** Scroll threshold (px) past which the bar enters compact mode. */
  compactAtPx?: number;
  /** Dead-zone width (px) below the enter threshold where state is held to
   *  prevent oscillation when the bar's own resize nudges scroll position. */
  hysteresisPx?: number;
  className?: string;
}

/**
 * Sticky container that shrinks as the user scrolls down. Uses two thresholds
 * (enter > compactAtPx, exit < compactAtPx - hysteresisPx) so the bar's resize
 * doesn't trip a feedback loop where shrinking moves content up, drops scrollY
 * back below the trigger, and grows the bar again — observed as flicker.
 */
export function ScrollAwareSticky({
  children,
  topOffsetPx,
  compactAtPx = 60,
  hysteresisPx = 40,
  className = ''
}: ScrollAwareStickyProps) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const enterAt = compactAtPx;
    const exitAt = Math.max(0, compactAtPx - hysteresisPx);
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        setCompact((prev) => (prev ? y > exitAt : y > enterAt));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, [compactAtPx, hysteresisPx]);

  return (
    <div
      data-compact={compact ? 'true' : 'false'}
      style={{ top: topOffsetPx }}
      className={`group/sticky sticky z-10 -mx-6 md:-mx-10 px-6 md:px-10 bg-[var(--background)]/85 backdrop-blur-md flex flex-col transition-[padding,gap] duration-200 ${
        compact ? 'pt-1.5 pb-0 gap-1 border-b border-[var(--border)]' : 'pt-4 pb-2 gap-4'
      } ${className}`}
    >
      {children}
    </div>
  );
}
