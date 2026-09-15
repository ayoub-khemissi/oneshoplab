'use client';

import { ArrowLeft, ArrowRight, Check, ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname as useRawPathname, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from '@/i18n/navigation';
import { ModalCloseButton } from '@/shared/ui';
import {
  centreBubble,
  demoPanel,
  needsScroll,
  placeBubble,
  spotlightOf,
  union,
  type BubblePlacement,
  type Rect
} from '../lib/placement';
import {
  fits,
  hrefFor,
  placeOf,
  resolveStep,
  stepIndex,
  stepsFor,
  type TourChapterId,
  type TourDemo,
  type TourStepId
} from '../model/steps';

export interface GuidedTourProps {
  /** Where the account left off, read from the DB on the server. */
  initialStep: TourStepId;
  /** The merchant's only store, so the tour can walk to it. */
  siteId: string | null;
  /** Replaying one chapter: the run then ends where that chapter ends. */
  chapter?: TourChapterId | null;
  onStep: (step: string) => void;
  onEnd: () => void;
}

/** How long to keep looking for an element the page may still be rendering:
 *  counted in attempts rather than clock time, so the loop stays pure. */
const ANCHOR_POLL_MS = 120;
const ANCHOR_ATTEMPTS = 34;

/** Attempts to wait before drawing the sample sheet: a page still on its way
 *  has no anchor either, and a demo that flashes over a merchant who DOES
 *  have products is its own kind of confusing. */
const DEMO_AFTER_ATTEMPTS = 8;

/** The sample product sheet: width, and the score it shows. */
const DEMO_WIDTH = 340;
const DEMO_HEIGHT = 190;
const DEMO_SCORE = 41;

/**
 * The first-store walkthrough: a dimmed page with one thing lit up, and a
 * bubble saying what it is for.
 *
 * Two decisions worth keeping:
 *
 * The highlighted element stays live. The dim is four panels laid AROUND the
 * spotlight rather than one sheet over everything, so the button under the
 * light can still be clicked — the merchant performs the real action instead
 * of watching a demo of it, and the tour catches up on the page they land on.
 *
 * Nothing is ever asserted about the DOM. A step whose anchor is missing —
 * a button that only appears after a generation, a card behind a plan — shows
 * its bubble in the middle of the screen and keeps going, rather than
 * pointing at a corner where nothing is. When the step carries a demo, it
 * draws that in the middle instead of a bubble over nothing: on a
 * ten-minute-old account there is no product to open, and an empty list under
 * an explanation of product pages teaches nobody anything.
 *
 * And a step about a menu opens it. The account menu spotlighted shut is a
 * lit avatar and a paragraph about things the merchant cannot see; the tour
 * opens it on the way in and closes it again on the way out.
 */
export function GuidedTour({ initialStep, siteId, chapter, onStep, onEnd }: GuidedTourProps) {
  // Every "which step is next / how many are there / is this the last one"
  // below reads this run, not the full list.
  const run = stepsFor(chapter);
  const t = useTranslations('Tour');
  const router = useRouter();
  const rawPath = useRawPathname();
  const search = useSearchParams();
  const [chosen, setChosen] = useState<TourStepId>(initialStep);
  const [rect, setRect] = useState<Rect | null>(null);
  const [closed, setClosed] = useState(false);
  const [bubbleHeight, setBubbleHeight] = useState(180);
  const [demoHeight, setDemoHeight] = useState(DEMO_HEIGHT);
  // The hunt (this step, on this page) that came up empty, so the sample
  // sheet can be shown for that one and no other. Keyed rather than reset:
  // the key stops matching on its own the moment either changes.
  const [missed, setMissed] = useState<string | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const demoRef = useRef<HTMLDivElement | null>(null);

  const place = placeOf(rawPath, search.get('tab'));
  const productId = place.kind === 'product' ? place.productId : null;
  const currentSiteId = place.kind === 'site' || place.kind === 'product' ? place.siteId : siteId;

  // The merchant leads. If they walked past the step we were on, pick up at
  // whatever this page is about instead of pointing at another screen. This
  // is derived during render, not in an effect: it is a pure function of the
  // URL, and an effect would paint the stale step first.
  const stepId = resolveStep(chosen, place, run);
  if (stepId !== chosen) setChosen(stepId);

  const step = run.find((s) => s.id === stepId) ?? run[0];
  const index = stepIndex(step.id, run);
  const onRightPage = fits(step, place);

  // The two callbacks are held in a ref because the caller passes fresh
  // arrows on every render: an effect depending on them directly would fire —
  // and write to the account — on every render of the page underneath.
  const handlers = useRef({ onStep, onEnd });
  useEffect(() => {
    handlers.current = { onStep, onEnd };
  }, [onStep, onEnd]);

  // Remembering the step is talking to the outside world, so it belongs in an
  // effect, and it must not be awaited (see TourMount).
  useEffect(() => {
    handlers.current.onStep(stepId);
  }, [stepId]);

  const anchor = step.anchor;
  const hunt = `${stepId}|${rawPath}`;
  // A step about a menu has to open it, and stop wanting it open the moment
  // the tour is over — hence `closed` here rather than an early return.
  const expands = step.expands === true && !closed;

  // Find the anchor, giving the page a few seconds to render it — a server
  // component still streaming in is the normal case, not the exception.
  useEffect(() => {
    let alive = true;
    let attempts = 0;
    // Set only when the tour itself opened the menu: what the merchant opened
    // is theirs to close, and what they close again we do not reopen.
    let opened = false;
    const tick = () => {
      if (!alive) return;
      attempts += 1;
      const el = anchor ? document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`) : null;
      if (el && needsScroll(el.getBoundingClientRect(), viewport())) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      if (el && expands && !opened && el.getAttribute('aria-expanded') === 'false') {
        el.click();
        opened = true;
      }
      const found = measureAnchor(anchor, expands);
      setRect(found);
      if (!found && attempts >= DEMO_AFTER_ATTEMPTS) setMissed(hunt);
      // The panel renders on the click's own pass, so the measurement that
      // includes it belongs to the NEXT tick: keep looking until it is in.
      const waiting = expands ? !panelOf(el) : !found;
      if (!anchor || !waiting || attempts >= ANCHOR_ATTEMPTS) return;
      window.setTimeout(tick, ANCHOR_POLL_MS);
    };
    // Deferred by a tick rather than run inline: looking before the paint
    // finds nothing and costs a render for it.
    const first = window.setTimeout(tick, 0);
    return () => {
      alive = false;
      window.clearTimeout(first);
      if (!opened || !anchor) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
      // Leaving the step puts the page back as it was found — but only if the
      // menu is still open, since clicking a shut one would open it instead.
      if (el?.getAttribute('aria-expanded') === 'true') el.click();
    };
  }, [anchor, hunt, expands]);

  // The page moves under the tour: sticky headers collapse, images load, the
  // merchant scrolls. The light has to stay on the same element.
  useEffect(() => {
    const onMove = () => setRect(measureAnchor(anchor, expands));
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [anchor, expands]);

  // The bubble's own height decides whether it fits below the spotlight, and
  // the copy is translated — German runs two lines longer than English on the
  // same step. So it is measured after paint rather than guessed. The guard is
  // what stops the measure/place/measure loop.
  useLayoutEffect(() => {
    const h = bubbleRef.current?.offsetHeight;
    if (h && Math.abs(h - bubbleHeight) > 1) setBubbleHeight(h);
  }, [bubbleHeight, stepId, rect]);

  // The sample sheet is measured the same way and for the same reason: its
  // height is what places it, and its copy is translated too.
  useLayoutEffect(() => {
    const h = demoRef.current?.offsetHeight;
    if (h && Math.abs(h - demoHeight) > 1) setDemoHeight(h);
  }, [demoHeight, stepId, rect]);

  // Leaving must always be one gesture away: Escape, the cross, or the link.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setClosed(true);
      handlers.current.onEnd();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function finish() {
    setClosed(true);
    onEnd();
  }

  function go(to: TourStepId) {
    setChosen(to);
    const target = run.find((s) => s.id === to);
    if (!target) return;
    const href = hrefFor(target, { siteId: currentSiteId, productId });
    // Only travel when the step genuinely lives somewhere else — pushing the
    // current URL would scroll the page back to the top for nothing.
    if (href && !fits(target, place)) router.push(href);
  }

  if (closed) return null;

  const last = index === run.length - 1;
  // The merchant is somewhere this step does not live — replaying a chapter
  // from the preferences lands them here every time. The primary button then
  // takes them to THIS step's page; sending them to the NEXT one would skip
  // the very step they asked to see.
  const stepHref = hrefFor(step, { siteId: currentSiteId, productId });
  const mustTravel = !onRightPage && stepHref !== null;
  const vp = viewport();
  // Nothing on the page to point at, but this step carries an illustration:
  // the tour draws its own sample product sheet and lights that up, rather
  // than explaining a product to someone whose catalogue is still empty. The
  // moment the real element shows up, it wins.
  const demo: TourDemo | null = rect === null && missed === hunt ? (step.demo ?? null) : null;
  const demoBox = demoPanel(vp, DEMO_WIDTH, demoHeight);
  const target = rect ?? (demo ? demoBox : null);
  const spot = target ? spotlightOf(target) : null;
  const bubble: BubblePlacement = spot
    ? placeBubble(spot, vp, bubbleHeight, step.side ?? 'bottom')
    : centreBubble(vp, bubbleHeight);

  const body = (
    <div className="fixed inset-0 z-[9998]" data-testid="guided-tour" data-step={step.id}>
      {spot ? (
        <Cutout spot={spot} viewport={vp} />
      ) : (
        // No anchor to light up — either by design (the welcome card) or
        // because this step's button is not on screen. Either way the page
        // stays usable underneath: a tutorial must never trap the merchant on
        // a step it cannot itself complete.
        <div className="pointer-events-none absolute inset-0 bg-black/50" />
      )}
      {spot ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-transparent transition-[top,left,width,height] duration-200"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      ) : null}
      {demo ? <DemoSheet box={demoBox} cardRef={demoRef} lit={demo === 'models'} /> : null}

      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="false"
        aria-label={t('ariaLabel')}
        className="absolute flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 pr-10 shadow-2xl"
        style={{ top: bubble.top, left: bubble.left, width: bubble.width }}
      >
        <ModalCloseButton onClose={finish} label={t('skip')} />
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--accent)]">
            {t('counter', { n: index + 1, total: run.length })}
          </span>
          <h2 className="text-sm font-semibold">{t(`steps.${step.id}.title`)}</h2>
        </div>
        <p className="text-xs leading-relaxed text-[var(--muted)]">{t(`steps.${step.id}.body`)}</p>
        {!onRightPage ? (
          <p className="text-[11px] leading-relaxed text-[var(--muted)] italic">{t('notHere')}</p>
        ) : null}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={finish}
            className="text-xs text-[var(--muted)] underline-offset-2 hover:underline"
          >
            {t('skip')}
          </button>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => go(run[index - 1].id)}
                aria-label={t('back')}
                className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] hover:bg-[var(--default)]"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (mustTravel) router.push(stepHref);
                else if (last) finish();
                else go(run[index + 1].id);
              }}
              data-testid="tour-next"
              data-last={!mustTravel && last}
              data-travel={mustTravel}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-medium text-[var(--accent-foreground)] hover:opacity-90"
            >
              {mustTravel ? t('goThere') : last ? t('finish') : t('next')}
              {!mustTravel && last ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <ArrowRight className="size-3.5" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/**
 * The dim, laid around the spotlight instead of over it.
 *
 * Four panels, not one sheet with a hole: the element in the light keeps
 * receiving clicks, which is what lets the merchant do the real thing.
 */
function Cutout({
  spot,
  viewport: vp
}: {
  spot: Rect;
  viewport: { width: number; height: number };
}) {
  const dim = 'absolute bg-black/60 transition-[top,left,width,height] duration-200';
  const bottom = spot.top + spot.height;
  const right = spot.left + spot.width;
  return (
    <>
      <div
        className={dim}
        style={{ top: 0, left: 0, width: vp.width, height: Math.max(0, spot.top) }}
      />
      <div
        className={dim}
        style={{ top: bottom, left: 0, width: vp.width, height: Math.max(0, vp.height - bottom) }}
      />
      <div
        className={dim}
        style={{ top: spot.top, left: 0, width: Math.max(0, spot.left), height: spot.height }}
      />
      <div
        className={dim}
        style={{
          top: spot.top,
          left: right,
          width: Math.max(0, vp.width - right),
          height: spot.height
        }}
      />
    </>
  );
}

/**
 * The product sheet the tour draws when the merchant has none of their own.
 *
 * The steps about a product used to point at an empty list on a fresh
 * account: a lit rectangle with nothing in it, under a paragraph describing
 * what it would have contained. This is the example instead — inert, marked
 * as one, and never written anywhere. `lit` picks out the model line, which
 * is what the following step is about.
 */
function DemoSheet({
  box,
  cardRef,
  lit
}: {
  box: Rect;
  cardRef: RefObject<HTMLDivElement | null>;
  lit: boolean;
}) {
  const t = useTranslations('Tour');
  return (
    <div
      ref={cardRef}
      data-testid="tour-demo"
      className="pointer-events-none absolute flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 shadow-2xl"
      style={{ top: box.top, left: box.left, width: box.width }}
    >
      <div className="flex items-start gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-md bg-[var(--default)] text-[var(--muted)]">
          <ImageIcon className="size-5" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{t('demo.title')}</span>
            <span className="rounded bg-[var(--accent)]/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">
              {t('demo.badge')}
            </span>
          </div>
          <span className="font-mono text-xs text-[var(--muted)]">
            {t('demo.score', { score: DEMO_SCORE })}
          </span>
        </div>
      </div>
      <div
        className={`rounded-md border px-2.5 py-1.5 text-[11px] ${
          lit
            ? 'border-[var(--accent)] text-[var(--accent)]'
            : 'border-dashed border-[var(--border)] text-[var(--muted)]'
        }`}
      >
        {t('demo.models')}
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--muted)] italic">{t('demo.note')}</p>
    </div>
  );
}

/** The dropdown an anchor opens, while it is open. */
function panelOf(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  const id = el.getAttribute('aria-controls');
  const named = id ? document.getElementById(id) : null;
  if (named) return named;
  // Nothing declares `aria-controls` here: the menu is the panel rendered
  // beside the button, inside the wrapper that positions it.
  return (
    el.parentElement?.querySelector<HTMLElement>(
      '[role="menu"], [role="listbox"], [role="dialog"]'
    ) ?? null
  );
}

/**
 * The anchor's box right now, or null when the page is not showing it.
 *
 * `withPanel` widens it to cover the dropdown the anchor has open, so the
 * light falls on the menu and not only on the button that opened it.
 */
function measureAnchor(anchor: string | undefined, withPanel = false): Rect | null {
  if (!anchor) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  const base = boxOf(el);
  if (!base) return null;
  if (!withPanel) return base;
  const panel = boxOf(panelOf(el));
  return panel ? union(base, panel) : base;
}

function boxOf(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}
