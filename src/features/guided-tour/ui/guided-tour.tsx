'use client';

import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname as useRawPathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from '@/i18n/navigation';
import { ModalCloseButton } from '@/shared/ui';
import {
  centreBubble,
  needsScroll,
  placeBubble,
  spotlightOf,
  type BubblePlacement,
  type Rect
} from '../lib/placement';
import {
  TOUR_STEPS,
  TOUR_TOTAL,
  fits,
  hrefFor,
  placeOf,
  resolveStep,
  stepById,
  stepIndex,
  type TourStepId
} from '../model/steps';

export interface GuidedTourProps {
  /** Where the account left off, read from the DB on the server. */
  initialStep: TourStepId;
  /** The merchant's only store, so the tour can walk to it. */
  siteId: string | null;
  onStep: (step: string) => void;
  onEnd: () => void;
}

/** How long to keep looking for an element the page may still be rendering. */
const ANCHOR_TIMEOUT_MS = 4000;
const ANCHOR_POLL_MS = 120;

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
 * pointing at a corner where nothing is.
 */
export function GuidedTour({ initialStep, siteId, onStep, onEnd }: GuidedTourProps) {
  const t = useTranslations('Tour');
  const router = useRouter();
  const rawPath = useRawPathname();
  const search = useSearchParams();
  const [chosen, setChosen] = useState<TourStepId>(initialStep);
  const [rect, setRect] = useState<Rect | null>(null);
  const [closed, setClosed] = useState(false);
  const [bubbleHeight, setBubbleHeight] = useState(180);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const place = placeOf(rawPath, search.get('tab'));
  const productId = place.kind === 'product' ? place.productId : null;
  const currentSiteId = place.kind === 'site' || place.kind === 'product' ? place.siteId : siteId;

  // The merchant leads. If they walked past the step we were on, pick up at
  // whatever this page is about instead of pointing at another screen. This
  // is derived during render, not in an effect: it is a pure function of the
  // URL, and an effect would paint the stale step first.
  const stepId = resolveStep(chosen, place);
  if (stepId !== chosen) setChosen(stepId);

  const step = stepById(stepId) ?? TOUR_STEPS[0];
  const index = stepIndex(step.id);
  const onRightPage = fits(step, place);

  // Remembering the step is talking to the outside world, so it belongs in an
  // effect — and it must not be awaited (see TourMount).
  useEffect(() => {
    onStep(stepId);
  }, [stepId, onStep]);

  const measure = useCallback(() => {
    if (!step.anchor) {
      setRect(null);
      return true;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!el) {
      setRect(null);
      return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setRect(null);
      return false;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    return true;
  }, [step.anchor]);

  // Find the anchor, giving the page a few seconds to finish rendering it —
  // a server component streaming in is the normal case, not the exception.
  useEffect(() => {
    let alive = true;
    const started = Date.now();
    const tick = () => {
      if (!alive) return;
      const el = step.anchor
        ? document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`)
        : null;
      if (el && needsScroll(el.getBoundingClientRect(), viewport())) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      if (measure() || Date.now() - started > ANCHOR_TIMEOUT_MS) return;
      window.setTimeout(tick, ANCHOR_POLL_MS);
    };
    // Deferred by a tick rather than run inline: the anchor often belongs to
    // a server component still streaming in, and looking before the paint
    // finds nothing and re-renders for it.
    const first = window.setTimeout(tick, 0);
    return () => {
      alive = false;
      window.clearTimeout(first);
    };
  }, [step.anchor, rawPath, measure]);

  // The page moves under the tour: sticky headers collapse, images load, the
  // merchant scrolls. The light has to stay on the same element.
  useEffect(() => {
    const onMove = () => measure();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [measure]);

  // The bubble's own height decides whether it fits below the spotlight, and
  // the copy is translated — German runs two lines longer than English on the
  // same step. So it is measured after paint rather than guessed. The guard is
  // what stops the measure/place/measure loop.
  useLayoutEffect(() => {
    const h = bubbleRef.current?.offsetHeight;
    if (h && Math.abs(h - bubbleHeight) > 1) setBubbleHeight(h);
  }, [bubbleHeight, stepId, rect]);

  const finish = useCallback(() => {
    setClosed(true);
    onEnd();
  }, [onEnd]);

  // Leaving must always be one gesture away: Escape, the cross, or the link.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const go = useCallback(
    (to: TourStepId) => {
      setChosen(to);
      const target = stepById(to);
      if (!target) return;
      const href = hrefFor(target, { siteId: currentSiteId, productId });
      // Only travel when the step genuinely lives somewhere else — pushing the
      // current URL would scroll the page back to the top for nothing.
      if (href && !fitsHere(to, rawPath, search.get('tab'))) router.push(href);
    },
    [currentSiteId, productId, router, rawPath, search]
  );

  if (closed) return null;

  const last = index === TOUR_TOTAL - 1;
  const spot = rect ? spotlightOf(rect) : null;
  const vp = viewport();
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
            {t('counter', { n: index + 1, total: TOUR_TOTAL })}
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
                onClick={() => go(TOUR_STEPS[index - 1].id)}
                aria-label={t('back')}
                className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] hover:bg-[var(--default)]"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => (last ? finish() : go(TOUR_STEPS[index + 1].id))}
              data-testid="tour-next"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-medium text-[var(--accent-foreground)] hover:opacity-90"
            >
              {last ? t('finish') : t('next')}
              {last ? (
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

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function fitsHere(id: TourStepId, pathname: string, tab: string | null): boolean {
  const target = stepById(id);
  if (!target) return false;
  const here = placeOf(pathname, tab);
  return resolveStep(id, here) === id && matches(target.where.kind, here.kind);
}

function matches(want: string, got: string): boolean {
  return want === 'anywhere' ? got !== 'elsewhere' : want === got;
}
