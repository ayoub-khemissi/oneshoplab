/**
 * Where the spotlight and its bubble go, as arithmetic.
 *
 * Kept away from the DOM on purpose: "the bubble is off-screen on a phone" is
 * the whole failure mode of a guided tour, and it is much easier to prove
 * against numbers than to chase in a browser.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Breathing room between the highlighted element and the dimmed area. */
export const SPOTLIGHT_PAD = 8;
/** Gap between the spotlight and the bubble. */
export const BUBBLE_GAP = 12;
/** The bubble never touches the edge of the screen. */
export const EDGE = 12;
export const BUBBLE_WIDTH = 320;

export function spotlightOf(target: Rect): Rect {
  return {
    top: target.top - SPOTLIGHT_PAD,
    left: target.left - SPOTLIGHT_PAD,
    width: target.width + SPOTLIGHT_PAD * 2,
    height: target.height + SPOTLIGHT_PAD * 2
  };
}

export interface BubblePlacement {
  top: number;
  left: number;
  width: number;
  side: 'top' | 'bottom';
}

/**
 * Put the bubble under the spotlight, or above it when there is not enough
 * room below — then clamp it inside the viewport on both axes.
 *
 * `bubbleHeight` is measured from the rendered card: the copy is translated,
 * and German takes two more lines than English on the same step.
 */
export function placeBubble(
  spot: Rect,
  viewport: Viewport,
  bubbleHeight: number,
  preferred: 'top' | 'bottom' = 'bottom'
): BubblePlacement {
  const width = Math.min(BUBBLE_WIDTH, viewport.width - EDGE * 2);
  const below = spot.top + spot.height + BUBBLE_GAP;
  const above = spot.top - BUBBLE_GAP - bubbleHeight;
  const fitsBelow = below + bubbleHeight <= viewport.height - EDGE;
  const fitsAbove = above >= EDGE;

  let side: 'top' | 'bottom';
  if (preferred === 'bottom') side = fitsBelow || !fitsAbove ? 'bottom' : 'top';
  else side = fitsAbove || !fitsBelow ? 'top' : 'bottom';

  const rawTop = side === 'bottom' ? below : above;
  // Centre on the spotlight, then pull back inside the screen. On a phone the
  // clamp is what actually decides the position most of the time.
  const rawLeft = spot.left + spot.width / 2 - width / 2;
  return {
    side,
    width,
    left: clamp(rawLeft, EDGE, Math.max(EDGE, viewport.width - width - EDGE)),
    top: clamp(rawTop, EDGE, Math.max(EDGE, viewport.height - bubbleHeight - EDGE))
  };
}

/** The bubble when there is nothing to point at: dead centre. */
export function centreBubble(viewport: Viewport, bubbleHeight: number): BubblePlacement {
  const width = Math.min(BUBBLE_WIDTH + 40, viewport.width - EDGE * 2);
  return {
    side: 'bottom',
    width,
    left: Math.max(EDGE, (viewport.width - width) / 2),
    top: Math.max(EDGE, (viewport.height - bubbleHeight) / 2)
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** Is the element far enough out of view that we should scroll to it first? */
export function needsScroll(target: Rect, viewport: Viewport): boolean {
  return target.top < EDGE || target.top + target.height > viewport.height - EDGE;
}
