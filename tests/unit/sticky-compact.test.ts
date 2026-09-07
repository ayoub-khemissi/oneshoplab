/**
 * The bar shrinks itself, and shrinking itself moves the page under it. That
 * feedback is the whole difficulty: if the jump in height clears the dead zone
 * between the two thresholds, the bar oscillates for ever — which is what a
 * merchant saw on a phone, "right between the two states".
 */
import { describe, expect, it } from 'vitest';
import {
  RESIZE_SETTLE_MS,
  compactThresholds,
  isSettling,
  nextCompact
} from '@/shared/ui/sticky-compact';

/** The real bar: ~30px of padding and gap, ~16px off the tab row. */
const REAL_DELTA = 46;

describe('the dead zone', () => {
  it('is never narrower than the bar’s own resize', () => {
    const t = compactThresholds(60, 40, REAL_DELTA);
    expect(t.enterAt - t.exitAt).toBeGreaterThan(REAL_DELTA);
  });

  it('keeps the configured hysteresis when it is already wide enough', () => {
    const t = compactThresholds(200, 120, 10);
    expect(t.enterAt - t.exitAt).toBe(120);
  });

  it('never asks for a negative scroll position', () => {
    // A small `enterAt` with a big bar: the exit threshold bottoms out at the
    // top of the page rather than at an offset nobody can reach.
    expect(compactThresholds(20, 40, 200).exitAt).toBe(0);
  });
});

describe('a bar that shrinks the page under itself', () => {
  /** Compacting removes `delta` px of page; the browser drags scroll with it. */
  function settle(enterAtPx: number, hysteresisPx: number, delta: number, startY: number) {
    const t = compactThresholds(enterAtPx, hysteresisPx, delta);
    let compact = false;
    let y = startY;
    const seen: boolean[] = [];
    for (let i = 0; i < 20; i += 1) {
      const next = nextCompact(compact, y, t);
      if (next === compact) return { settled: true, flips: seen.length, compact };
      // The page got shorter (or taller) by the bar's own height change.
      y += next ? -delta : delta;
      compact = next;
      seen.push(next);
    }
    return { settled: false, flips: seen.length, compact };
  }

  it('settles instead of looping, at the threshold that used to loop', () => {
    // 61px with a 40px dead zone and a 46px jump was the reported bug: compact
    // at 61 → page shorter → 15 → expand → 61 → …
    expect(settle(60, 40, REAL_DELTA, 61).settled).toBe(true);
  });

  it('settles from every position around the threshold', () => {
    for (let y = 0; y <= 200; y += 1) {
      const res = settle(60, 40, REAL_DELTA, y);
      expect(res.settled, `oscillated starting at scrollY=${y}`).toBe(true);
    }
  });

  it('would have looped with the old dead zone — the bug, reproduced', () => {
    // Same walk with the hysteresis the component used to trust blindly.
    const t = { enterAt: 60, exitAt: 20 };
    let compact = false;
    let y = 61;
    let flips = 0;
    for (let i = 0; i < 20; i += 1) {
      const next = nextCompact(compact, y, t);
      if (next === compact) break;
      y += next ? -REAL_DELTA : REAL_DELTA;
      compact = next;
      flips += 1;
    }
    expect(flips).toBe(20);
  });
});

describe('nextCompact', () => {
  const t = compactThresholds(60, 40, REAL_DELTA);

  it('holds whatever it is doing inside the dead zone', () => {
    const between = (t.enterAt + t.exitAt) / 2;
    expect(nextCompact(true, between, t)).toBe(true);
    expect(nextCompact(false, between, t)).toBe(false);
  });

  it('compacts past the top threshold and expands below the bottom one', () => {
    expect(nextCompact(false, t.enterAt + 1, t)).toBe(true);
    expect(nextCompact(true, t.exitAt - 1, t)).toBe(false);
  });
});

describe('the wake of the bar’s own resize', () => {
  it('ignores scroll until the transition has finished', () => {
    const t0 = 1_000_000;
    expect(isSettling(t0 + 10, t0)).toBe(true);
    expect(isSettling(t0 + RESIZE_SETTLE_MS - 1, t0)).toBe(true);
    expect(isSettling(t0 + RESIZE_SETTLE_MS, t0)).toBe(false);
  });

  it('listens normally before anything has changed', () => {
    expect(isSettling(Date.now(), null)).toBe(false);
  });

  it('rate-limits a bar that would otherwise flap every frame', () => {
    // Honest about what this buys: with a dead zone deliberately narrower than
    // the resize, the state still disagrees once the wake passes, so the
    // settle window slows the flapping to one change per window instead of one
    // per frame. It is the dead zone above that makes it STOP; this is what
    // keeps a mistake there from being a strobe light.
    const t = { enterAt: 60, exitAt: 20 }; // deliberately too narrow
    let compact = false;
    let y = 61;
    let changedAt: number | null = null;
    let now = 0;
    let flips = 0;
    const frames = 60; // ~1 second at 60fps
    for (let i = 0; i < frames; i += 1) {
      now += 16;
      if (isSettling(now, changedAt)) continue;
      const next = nextCompact(compact, y, t);
      if (next === compact) break;
      changedAt = now;
      y += next ? -120 : 120;
      compact = next;
      flips += 1;
    }
    const windows = Math.ceil((frames * 16) / RESIZE_SETTLE_MS);
    expect(flips).toBeLessThanOrEqual(windows);
    // Without the window it would change on nearly every one of the 60 frames.
    expect(flips).toBeLessThan(10);
  });

  it('the dead zone can absorb a resize only up to the enter threshold', () => {
    // Worth stating, because it bounds what the arithmetic can promise: the
    // exit threshold cannot go below the top of the page, so a bar that
    // resized by MORE than `enterAt` would swing across the zone whatever the
    // hysteresis. The real bar changes by ~46px against an enter threshold of
    // 60, so it fits — and the settle window above covers the rest.
    const fits = compactThresholds(60, 40, REAL_DELTA);
    expect(fits.exitAt).toBe(0);
    expect(nextCompact(true, 61 - REAL_DELTA, fits)).toBe(true);

    const tooBig = compactThresholds(60, 40, 120);
    expect(tooBig.exitAt).toBe(0);
    // Nothing left to widen: this is the case the settle window exists for.
    expect(nextCompact(true, Math.max(0, 61 - 120), tooBig)).toBe(false);
  });
});
