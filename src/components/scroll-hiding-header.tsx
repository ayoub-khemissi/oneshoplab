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

const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

/**
 * Mobile-only scroll-aware header wrapper. Translates the header
 * out of view on scroll-down and brings it back on scroll-up. On
 * `md+` viewports the wrapper is a no-op so the desktop header stays
 * permanently visible.
 *
 * Also publishes the header's current visual height to the document
 * via the `--site-header-h` CSS variable: full height when visible,
 * 0 when hidden (mobile only). Page-level sticky bars (the per-site
 * dashboard tabs row) read this var so they slide up to take the
 * header's place when it hides, and back down when it returns —
 * with a CSS transition for the slide animation.
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
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  // Publish the visible header height to the rest of the page via a
  // CSS variable. On desktop the header never hides (md:translate-y-0)
  // so the var is always its real height. On mobile it goes to 0 the
  // moment the user scrolls down so the next sticky bar (e.g. the
  // per-site tabs row) can slide up to top:0.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const mq = window.matchMedia(MOBILE_BREAKPOINT_QUERY);

    const update = () => {
      const isMobile = mq.matches;
      const value = isMobile && hidden ? 0 : el.offsetHeight;
      document.documentElement.style.setProperty('--site-header-h', `${value}px`);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);

    return () => {
      ro.disconnect();
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [hidden]);

  return (
    <div
      ref={wrapperRef}
      className={`sticky top-0 z-20 transition-transform duration-200 will-change-transform ${
        hidden ? '-translate-y-full md:translate-y-0' : 'translate-y-0'
      }`}
    >
      {children}
    </div>
  );
}
