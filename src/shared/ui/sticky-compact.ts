/**
 * When a scroll-aware bar should be compact.
 *
 * Pulled out of the component because the interesting part is not the DOM: a
 * bar that shrinks itself changes the height of the page it is measuring
 * against, and if that jump is larger than the dead zone between the two
 * thresholds, the bar flips back — then forward — for ever. Reported from a
 * phone as "an infinite loop of shrinking and growing, right between the two
 * states".
 *
 * The invariant is arithmetic, so it is decided and tested as arithmetic.
 */

export interface CompactThresholds {
  /** Scrolled past this, the bar becomes compact. */
  enterAt: number;
  /** Back above this, it expands again. Always below `enterAt`. */
  exitAt: number;
}

/** Never let the dead zone be narrower than the jump, plus room to spare. */
const SAFETY_PX = 24;

/**
 * The two thresholds, widened to swallow the bar's own resize.
 *
 * `measuredDeltaPx` is how much shorter the page got when the bar last
 * shrank — read from the live element rather than assumed, so restyling the
 * bar (a smaller tab row, one less line of status) cannot quietly re-open the
 * loop. Until a first measurement exists it is 0 and the configured
 * hysteresis stands on its own.
 */
export function compactThresholds(
  enterAtPx: number,
  hysteresisPx: number,
  measuredDeltaPx = 0
): CompactThresholds {
  const deadZone = Math.max(hysteresisPx, measuredDeltaPx + SAFETY_PX);
  return { enterAt: enterAtPx, exitAt: Math.max(0, enterAtPx - deadZone) };
}

/**
 * The next state. Compact is entered high and left low: between the two
 * thresholds, whatever the bar is already doing is what it keeps doing.
 */
export function nextCompact(prev: boolean, scrollY: number, t: CompactThresholds): boolean {
  return prev ? scrollY > t.exitAt : scrollY > t.enterAt;
}

/**
 * How long the bar ignores scroll after changing size.
 *
 * The dead zone above assumes the only thing that moves the page is the
 * merchant. It isn't: the bar's own resize shortens the document, and a
 * browser answers that by moving the scroll position — clamping at the bottom
 * of a short page, or scroll-anchoring to keep content still. Those are scroll
 * events the bar caused, and letting them decide its next state is the loop.
 *
 * So after each change it stops listening until its own transition has
 * finished. Whatever the browser did in the meantime is read once, afterwards,
 * as a starting point rather than as a reason to flip back. This holds even if
 * a future restyle makes the resize larger than any dead zone.
 */
export const RESIZE_SETTLE_MS = 260;

/** Is this scroll sample still inside the wake of our own resize? */
export function isSettling(now: number, changedAt: number | null): boolean {
  return changedAt != null && now - changedAt < RESIZE_SETTLE_MS;
}
