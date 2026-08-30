/**
 * Run a `router.refresh()` (or any action that re-renders the current
 * route) WITHOUT letting the page jump back to the top.
 *
 * Why this is needed: the product route is `force-dynamic` and ships a
 * `loading.tsx`. On `router.refresh()` Next briefly swaps in that (short)
 * skeleton while the fresh RSC payload streams in. The document collapses
 * to a fraction of its scrolled height, the browser clamps the scroll
 * offset to the new (tiny) maximum — i.e. the top — and the user is yanked
 * up. `router.refresh()` is load-bearing here (it surfaces freshly
 * generated text and updates the header credit chip), so we can't just drop
 * it; instead we snap the prior offset back as soon as the real, tall
 * content returns.
 *
 * Guards:
 *  - No-op preservation when already at the top (nothing to lose) or in SSR.
 *  - We only ever snap *up→back-down* (when the browser clamped us above the
 *    original offset). A user who deliberately scrolls further down during
 *    the refresh window is never overridden.
 */
export function refreshKeepingScroll(refresh: () => void): void {
  if (typeof window === 'undefined') {
    refresh();
    return;
  }
  const el = document.scrollingElement ?? document.documentElement;
  const y = el.scrollTop;
  if (y <= 0) {
    refresh();
    return;
  }

  refresh();

  const deadline = Date.now() + 1200;
  let restoredOnce = false;
  const tick = () => {
    const maxScroll = el.scrollHeight - el.clientHeight;
    // Only restore once the page is tall enough to hold the original
    // offset again — otherwise scrollTop would just get re-clamped.
    if (maxScroll >= y - 1) {
      if (el.scrollTop < y) el.scrollTop = y;
      restoredOnce = true;
    }
    // Keep watching until we've restored at least once, and keep catching
    // a late commit-time yank-to-top, but never past the deadline and never
    // against a deliberate downward scroll.
    if (Date.now() < deadline && (!restoredOnce || el.scrollTop < y)) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}
