'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RESIZE_SETTLE_MS, compactThresholds, isSettling, nextCompact } from './sticky-compact';

interface ScrollAwareStickyProps {
  children: ReactNode;
  /** Distance (px) from the top of the viewport where the bar sticks. */
  topOffsetPx: number;
  /** Scroll threshold (px) past which the bar enters compact mode. */
  compactAtPx?: number;
  /** Minimum dead-zone width (px) below the enter threshold where the state is
   *  held. Widened at runtime when the bar turns out to resize by more than
   *  this — see `compactThresholds`. */
  hysteresisPx?: number;
  className?: string;
}

/**
 * Sticky container that shrinks as the user scrolls down.
 *
 * The hard part is that it shrinks the page it is measuring against. Two
 * thresholds are not enough on their own: the dead zone between them has to be
 * WIDER than the bar's own height change, or compacting drops scroll below the
 * exit threshold, which expands the bar, which pushes scroll back above the
 * enter threshold, for ever. It shipped that way — 40px of hysteresis against
 * a ~46px resize — and a merchant found it from a phone, "an infinite loop of
 * shrinking and growing, right between the two states".
 *
 * So the resize is measured rather than assumed, and the dead zone follows it.
 * Restyling the bar (a tighter tab row, one line more of status) cannot
 * quietly re-open the loop.
 *
 * `overflow-anchor: none` closes the second door to the same behaviour: left
 * on, the browser helpfully scrolls to keep content still when the bar
 * resizes, which is itself a scroll change that can trip the thresholds.
 */
export function ScrollAwareSticky({
  children,
  topOffsetPx,
  compactAtPx = 60,
  hysteresisPx = 40,
  className = ''
}: ScrollAwareStickyProps) {
  const [compact, setCompact] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  /** Tallest expanded and shortest compact heights seen, so the difference is
   *  the real jump rather than the one mid-transition. */
  const seen = useRef({ expanded: 0, compact: Number.POSITIVE_INFINITY });
  const delta = useRef(0);
  const compactRef = useRef(compact);
  /** When the bar last changed size, so the scroll THAT caused cannot decide
   *  its next state. */
  const changedAt = useRef<number | null>(null);
  useEffect(() => {
    compactRef.current = compact;
  }, [compact]);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h === 0) return;
      if (compactRef.current) seen.current.compact = Math.min(seen.current.compact, h);
      else seen.current.expanded = Math.max(seen.current.expanded, h);
      const { expanded, compact: small } = seen.current;
      if (expanded > 0 && Number.isFinite(small)) delta.current = Math.max(0, expanded - small);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let wake = 0;

    const evaluate = () => {
      const now = Date.now();
      // Deaf to the scroll our own resize just produced — but not forgetful:
      // scroll events stop firing the moment the merchant lifts their finger,
      // so the state has to be reconsidered when the wake passes rather than
      // waiting for a scroll that may never come.
      if (isSettling(now, changedAt.current)) {
        if (!wake) {
          const left = RESIZE_SETTLE_MS - (now - (changedAt.current ?? now));
          wake = window.setTimeout(
            () => {
              wake = 0;
              evaluate();
            },
            Math.max(0, left) + 16
          );
        }
        return;
      }
      const thresholds = compactThresholds(compactAtPx, hysteresisPx, delta.current);
      setCompact((prev) => {
        const next = nextCompact(prev, window.scrollY, thresholds);
        if (next !== prev) changedAt.current = Date.now();
        return next;
      });
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        evaluate();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    evaluate();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (wake) window.clearTimeout(wake);
      window.removeEventListener('scroll', onScroll);
    };
  }, [compactAtPx, hysteresisPx]);

  return (
    <div
      ref={barRef}
      data-compact={compact ? 'true' : 'false'}
      // Stick directly under the visible main header. The
      // --site-header-h CSS var is published by <ScrollHidingHeader>
      // and tracks the header's actual rendered height (0 when the
      // header is hidden on mobile scroll-down). Falls back to
      // topOffsetPx when the var isn't set (e.g. pages without the
      // ScrollHidingHeader wrapper) so this component stays drop-in
      // safe.
      style={{ top: `var(--site-header-h, ${topOffsetPx}px)`, overflowAnchor: 'none' }}
      // On a phone the bar eats the parent's top padding the same way it
      // already eats the side gutters: <main> is `p-4 md:p-10`, and stacking
      // that 16px under the site header and on top of the bar's own padding
      // left ~32px of nothing above the store's name — a third of what a
      // small screen shows below the header. Desktop keeps its rhythm.
      className={`group/sticky sticky z-10 -mx-4 md:-mx-10 px-4 md:px-10 -mt-4 md:mt-0 bg-[var(--background)]/85 backdrop-blur-md flex flex-col transition-[top,padding,gap] duration-200 ${
        compact
          ? 'pt-1.5 pb-0 gap-1 border-b border-[var(--border)]'
          : 'pt-2 pb-2 gap-2 md:pt-4 md:gap-4'
      } ${className}`}
    >
      {children}
    </div>
  );
}
