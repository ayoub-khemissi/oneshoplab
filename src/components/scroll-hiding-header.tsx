'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ScrollHidingHeaderProps {
  children: ReactNode;
  /** Scroll past this many px before "hide on scroll-down" kicks in.
   *  Below the threshold the header is always visible — avoids the
   *  bar disappearing on the smallest flicks at the top of the page. */
  thresholdPx?: number;
  /** Minimum |delta| between consecutive scroll samples before we
   *  consider a direction change. Filters out scroll-snap jitter. */
  minDeltaPx?: number;
}

/**
 * Mobile-only scroll-aware header wrapper. Translates the header
 * out of view on scroll-down and brings it back on scroll-up. On
 * `md+` viewports the wrapper is a no-op so the desktop header stays
 * permanently visible.
 *
 * Why a wrapper, not an enhancement on the `<header>` directly: the
 * header is a server component (it reads the auth session) and we
 * only need a small slice of client state. Wrapping keeps the rest
 * of the header on the server.
 */
export function ScrollHidingHeader({
  children,
  thresholdPx = 80,
  minDeltaPx = 4
}: ScrollHidingHeaderProps) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        const delta = y - lastY.current;
        if (Math.abs(delta) < minDeltaPx) return;
        if (delta > 0 && y > thresholdPx) {
          setHidden(true);
        } else if (delta < 0) {
          setHidden(false);
        }
        lastY.current = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, [thresholdPx, minDeltaPx]);

  return (
    <div
      className={`sticky top-0 z-20 transition-transform duration-200 will-change-transform ${
        hidden ? '-translate-y-full md:translate-y-0' : 'translate-y-0'
      }`}
    >
      {children}
    </div>
  );
}
