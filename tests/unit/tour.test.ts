/**
 * The first-store walkthrough, checked where it actually breaks.
 *
 * Three failure modes, none of which the compiler can see: a step pointing at
 * an element nobody renders any more, a bubble sitting off-screen on a phone,
 * and a tour that keeps talking about a page the merchant has left.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TOUR_CHAPTERS,
  TOUR_STEPS,
  firstStepOf,
  hrefFor,
  placeOf,
  resolveStep,
  stepById,
  stepsFor,
  type TourStepId
} from '@/features/guided-tour/model/steps';
import {
  centreBubble,
  demoPanel,
  placeBubble,
  spotlightOf,
  union
} from '@/features/guided-tour/lib/placement';

const SRC = new URL('../../src', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.tsx?$/.test(e.name) ? [readFileSync(full, 'utf8')] : [];
  });
}
const ALL_SOURCE = sources(SRC).join('\n');

describe('the anchors the tour points at', () => {
  it.each(TOUR_STEPS.filter((s) => s.anchor).map((s) => [s.id, s.anchor!]))(
    '%s points at data-tour="%s", which something renders',
    (_id, anchor) => {
      // A tour whose light falls on nothing is worse than no tour: the
      // merchant reads an instruction about a button that is not there. If a
      // refactor drops the anchor, it fails here and not in production.
      // Matched as a quoted string because several anchors reach `data-tour`
      // through a prop (`tour="tab-products"`) rather than inline.
      expect(ALL_SOURCE).toMatch(new RegExp(`['"\`]${anchor}['"\`]`));
    }
  );
});

describe('the steps that have nothing to point at', () => {
  it('the product steps carry a sample sheet', () => {
    // A merchant on their first day has no catalogue: without a demo these
    // two light up an empty list and explain something off-screen.
    const withDemo = TOUR_STEPS.filter((s) => s.demo).map((s) => s.id);
    expect(withDemo).toEqual(['product', 'models']);
  });

  it('the step about the account menu opens it, and has a menu to open', () => {
    const expanding = TOUR_STEPS.filter((s) => s.expands);
    expect(expanding.map((s) => s.id)).toEqual(['tips']);
    // Nothing to open without an anchor to open it on.
    for (const step of expanding) expect(step.anchor).toBeTruthy();
  });

  it('the account menu button says whether it is open', () => {
    // The overlay opens the dropdown by clicking the anchor, and only when it
    // reads shut: `aria-expanded` is the contract that makes that safe.
    const menu = ALL_SOURCE.slice(
      Math.max(0, ALL_SOURCE.indexOf('data-tour="account-menu"') - 600),
      ALL_SOURCE.indexOf('data-tour="account-menu"') + 600
    );
    expect(menu).toMatch(/aria-expanded/);
  });
});

describe('reading the URL', () => {
  it('recognises the pages the tour walks through', () => {
    expect(placeOf('/fr/dashboard')).toEqual({ kind: 'dashboard' });
    expect(placeOf('/en/dashboard/sites/abc')).toEqual({
      kind: 'site',
      siteId: 'abc',
      tab: 'overview'
    });
    expect(placeOf('/fr/dashboard/sites/abc', 'settings')).toEqual({
      kind: 'site',
      siteId: 'abc',
      tab: 'settings'
    });
    expect(placeOf('/fr/dashboard/sites/abc/products/p1')).toEqual({
      kind: 'product',
      siteId: 'abc',
      productId: 'p1'
    });
  });

  it('an unknown tab is the overview, never a crash', () => {
    expect(placeOf('/fr/dashboard/sites/abc', 'nonsense')).toMatchObject({ tab: 'overview' });
  });

  it('anywhere outside the dashboard is elsewhere', () => {
    expect(placeOf('/fr/pricing')).toEqual({ kind: 'elsewhere' });
    expect(placeOf('/fr/dashboard/sites/abc/products/new')).toEqual({ kind: 'elsewhere' });
  });
});

describe('following the merchant', () => {
  it('catches up when they jump ahead', () => {
    // They clicked into a product while the tour was still on "connect".
    const at = resolveStep('connect', placeOf('/fr/dashboard/sites/s1/products/p1'));
    expect(at).toBe('models');
  });

  it('stays put while they are on the right page', () => {
    expect(resolveStep('platform', placeOf('/fr/dashboard/sites/s1', 'integrations'))).toBe(
      'platform'
    );
  });

  it('never rewinds on its own', () => {
    // Back on the dashboard after the product steps: going back would be a
    // decision, and it is the merchant's, not ours.
    expect(resolveStep('photos', placeOf('/fr/dashboard'))).toBe('photos');
  });

  it('holds the step when the page is not one it knows', () => {
    expect(resolveStep('score', placeOf('/fr/pricing'))).toBe('score');
  });
});

describe('where "Next" goes', () => {
  const ctx = { siteId: 's1', productId: 'p1' };
  it.each([
    ['audit', '/dashboard'],
    ['platform', '/dashboard/sites/s1?tab=integrations'],
    ['settings', '/dashboard/sites/s1?tab=settings'],
    ['score', '/dashboard/sites/s1'],
    ['generate', '/dashboard/sites/s1/products/p1']
  ])('%s → %s', (id, href) => {
    expect(hrefFor(stepById(id as TourStepId)!, ctx)).toBe(href);
  });

  it('has nowhere to send a merchant with no store yet', () => {
    expect(hrefFor(stepById('score')!, { siteId: null, productId: null })).toBeNull();
  });
});

describe('the bubble stays on screen', () => {
  const phone = { width: 390, height: 844 };

  it('sits under the spotlight when there is room', () => {
    const spot = spotlightOf({ top: 100, left: 40, width: 200, height: 44 });
    const b = placeBubble(spot, phone, 180, 'bottom');
    expect(b.side).toBe('bottom');
    expect(b.top).toBeGreaterThan(spot.top + spot.height);
    expect(b.top + 180).toBeLessThanOrEqual(phone.height);
  });

  it('flips above when the target is at the bottom of the screen', () => {
    const spot = spotlightOf({ top: 760, left: 40, width: 200, height: 44 });
    const b = placeBubble(spot, phone, 180, 'bottom');
    expect(b.side).toBe('top');
    expect(b.top).toBeGreaterThanOrEqual(0);
  });

  it('never hangs off the left or right edge', () => {
    for (const left of [-50, 0, 200, 380, 900]) {
      const b = placeBubble(spotlightOf({ top: 300, left, width: 40, height: 40 }), phone, 160);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.left + b.width).toBeLessThanOrEqual(phone.width);
    }
  });

  it('a target taller than the screen still leaves the bubble visible', () => {
    // The image editor on a phone: the anchor is the whole section.
    const b = placeBubble(spotlightOf({ top: 0, left: 0, width: 390, height: 2000 }), phone, 200);
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.top + 200).toBeLessThanOrEqual(phone.height);
  });

  it('a spotlight on a menu covers the button and the menu it opened', () => {
    const button = { top: 20, left: 300, width: 40, height: 40 };
    const menu = { top: 68, left: 150, width: 240, height: 300 };
    const both = union(button, menu);
    expect(both).toEqual({ top: 20, left: 150, width: 240, height: 348 });
    // Nothing of either box falls outside the union.
    for (const r of [button, menu]) {
      expect(r.top).toBeGreaterThanOrEqual(both.top);
      expect(r.left).toBeGreaterThanOrEqual(both.left);
      expect(r.left + r.width).toBeLessThanOrEqual(both.left + both.width);
      expect(r.top + r.height).toBeLessThanOrEqual(both.top + both.height);
    }
  });

  it('the sample sheet sits on screen, with room for its bubble underneath', () => {
    const panel = demoPanel(phone, 340, 190);
    expect(panel.left).toBeGreaterThanOrEqual(0);
    expect(panel.left + panel.width).toBeLessThanOrEqual(phone.width);
    expect(panel.top).toBeGreaterThanOrEqual(0);
    expect(panel.top + panel.height).toBeLessThanOrEqual(phone.height);
    const b = placeBubble(spotlightOf(panel), phone, 180, 'bottom');
    expect(b.side).toBe('bottom');
    expect(b.top).toBeGreaterThan(panel.top + panel.height);
    expect(b.top + 180).toBeLessThanOrEqual(phone.height);
  });

  it('the sample sheet never overflows a narrow screen', () => {
    const tiny = { width: 280, height: 500 };
    const panel = demoPanel(tiny, 340, 600);
    expect(panel.left + panel.width).toBeLessThanOrEqual(tiny.width);
    expect(panel.top).toBeGreaterThanOrEqual(0);
  });

  it('centres itself when there is nothing to point at', () => {
    const b = centreBubble(phone, 200);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.left + b.width).toBeLessThanOrEqual(phone.width);
    expect(b.top).toBeCloseTo((phone.height - 200) / 2, 0);
  });
});

describe('the copy', () => {
  const messages = (locale: string) =>
    JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'))
      .Tour as { steps: Record<string, { title: string; body: string }> };

  it.each(['en', 'fr'])('%s says something for every step', (locale) => {
    const tour = messages(locale);
    for (const step of TOUR_STEPS) {
      expect(tour.steps[step.id]?.title?.length ?? 0).toBeGreaterThan(2);
      expect(tour.steps[step.id]?.body?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it.each(['en', 'fr'])('%s describes the sample product sheet', (locale) => {
    // The demo is drawn by the tour, so its words come from here and nowhere
    // else — a hole would render an empty card next to "open a product".
    const demo = (messages(locale) as unknown as { demo: Record<string, string> }).demo;
    for (const key of ['badge', 'title', 'score', 'models', 'note']) {
      expect(demo?.[key]?.length ?? 0).toBeGreaterThan(1);
    }
    expect(demo.score).toContain('{score}');
  });
});

describe('replaying one chapter', () => {
  it('covers every step exactly once, in order', () => {
    // A step that belongs to no chapter can never be replayed, and one in two
    // chapters would be played twice: both are silent holes in the feature.
    const covered = TOUR_CHAPTERS.flatMap((c) => stepsFor(c).map((s) => s.id));
    expect(covered).toEqual(TOUR_STEPS.map((s) => s.id));
  });

  it('every chapter has a first step to start on', () => {
    for (const chapter of TOUR_CHAPTERS) {
      expect(stepsFor(chapter)[0].id).toBe(firstStepOf(chapter));
    }
  });

  it('a run stops at the end of its chapter instead of walking on', () => {
    const connect = stepsFor('connect');
    expect(connect.map((s) => s.id)).toEqual(['connect', 'platform']);
    // Nothing in the run points past the chapter, so "last step" is real.
    expect(connect.at(-1)!.id).not.toBe(TOUR_STEPS.at(-1)!.id);
  });

  it('catching up never escapes the chapter being replayed', () => {
    // Replaying "connect", the merchant wanders onto a product page. The tour
    // must not silently continue into the generation chapter they did not ask
    // for — it holds its step.
    const run = stepsFor('connect');
    const at = resolveStep('connect', placeOf('/fr/dashboard/sites/s1/products/p1'), run);
    expect(run.some((s) => s.id === at)).toBe(true);
  });

  it('no chapter is the whole tour by accident', () => {
    for (const chapter of TOUR_CHAPTERS) {
      expect(stepsFor(chapter).length).toBeLessThan(TOUR_STEPS.length);
    }
  });

  it('no chapter falls back to the whole tour on an unknown value', () => {
    expect(stepsFor(null)).toEqual(TOUR_STEPS);
  });
});
