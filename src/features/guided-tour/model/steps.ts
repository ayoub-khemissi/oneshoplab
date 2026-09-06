/**
 * The walkthrough a merchant sees once, on their first store.
 *
 * The order is the path itself — audit, read the report, connect the store,
 * open a product, generate, send it back, then the settings that apply to
 * everything. Each step names the element it points at (`data-tour="…"`) and
 * the page that element lives on; nothing here touches the DOM, so the whole
 * thing is decided and tested as data.
 */

export const TOUR_STEP_IDS = [
  'welcome',
  'audit',
  'score',
  'connect',
  'platform',
  'products',
  'product',
  'models',
  'generate',
  'apply',
  'photos',
  'settings',
  'tips'
] as const;

export type TourStepId = (typeof TOUR_STEP_IDS)[number];

/**
 * The walkthrough in chapters, so it can be replayed a piece at a time.
 *
 * "How do I connect my store again?" is a different question from "how does
 * generation work?", and answering the first should not cost the merchant a
 * ride through all thirteen steps.
 */
export const TOUR_CHAPTERS = [
  'start',
  'connect',
  'products',
  'generate',
  'photos',
  'settings'
] as const;

export type TourChapterId = (typeof TOUR_CHAPTERS)[number];

export type SiteTab = 'overview' | 'products' | 'jobs' | 'integrations' | 'settings';

/** Where the merchant currently is, stripped of locale and ids. */
export type TourPlace =
  | { kind: 'dashboard' }
  | { kind: 'site'; siteId: string; tab: SiteTab }
  | { kind: 'product'; siteId: string; productId: string }
  | { kind: 'elsewhere' };

/** Where a step wants the merchant to be. `anywhere` follows them around. */
export type TourWhere =
  | { kind: 'dashboard' }
  | { kind: 'site'; tab?: SiteTab }
  | { kind: 'product' }
  | { kind: 'anywhere' };

export interface TourStep {
  id: TourStepId;
  chapter: TourChapterId;
  /** The `data-tour` value to spotlight. Absent = a card in the middle. */
  anchor?: string;
  where: TourWhere;
  /** Preferred side for the bubble; it flips on its own when there is no room. */
  side?: 'top' | 'bottom';
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', chapter: 'start', where: { kind: 'dashboard' } },
  {
    id: 'audit',
    chapter: 'start',
    anchor: 'audit-cta',
    where: { kind: 'dashboard' },
    side: 'bottom'
  },
  {
    id: 'score',
    chapter: 'start',
    anchor: 'site-score',
    where: { kind: 'site', tab: 'overview' },
    side: 'bottom'
  },
  {
    id: 'connect',
    chapter: 'connect',
    anchor: 'tab-integrations',
    where: { kind: 'site' },
    side: 'bottom'
  },
  {
    id: 'platform',
    chapter: 'connect',
    anchor: 'integrations-wizard',
    where: { kind: 'site', tab: 'integrations' },
    side: 'top'
  },
  {
    id: 'products',
    chapter: 'products',
    anchor: 'tab-products',
    where: { kind: 'site' },
    side: 'bottom'
  },
  {
    id: 'product',
    chapter: 'products',
    anchor: 'product-row',
    where: { kind: 'site', tab: 'products' },
    side: 'bottom'
  },
  {
    id: 'models',
    chapter: 'generate',
    anchor: 'model-chips',
    where: { kind: 'product' },
    side: 'bottom'
  },
  {
    id: 'generate',
    chapter: 'generate',
    anchor: 'field-title',
    where: { kind: 'product' },
    side: 'top'
  },
  {
    id: 'apply',
    chapter: 'generate',
    anchor: 'apply-to-store',
    where: { kind: 'product' },
    side: 'top'
  },
  {
    id: 'photos',
    chapter: 'photos',
    anchor: 'image-editor',
    where: { kind: 'product' },
    side: 'top'
  },
  {
    id: 'settings',
    chapter: 'settings',
    anchor: 'site-settings',
    where: { kind: 'site', tab: 'settings' },
    side: 'bottom'
  },
  {
    id: 'tips',
    chapter: 'settings',
    anchor: 'account-menu',
    where: { kind: 'anywhere' },
    side: 'bottom'
  }
] as const;

export const FIRST_STEP: TourStepId = TOUR_STEPS[0].id;

export function stepById(id: string | null | undefined): TourStep | null {
  return TOUR_STEPS.find((s) => s.id === id) ?? null;
}

export function isChapterId(value: unknown): value is TourChapterId {
  return typeof value === 'string' && (TOUR_CHAPTERS as readonly string[]).includes(value);
}

/**
 * The run to play: the whole thing, or one chapter on its own.
 *
 * Everything downstream — the counter, "is this the last step", where Next
 * goes — reads this list rather than the constant, so a chapter replay ends
 * at the end of the CHAPTER instead of walking on into the next subject.
 */
export function stepsFor(chapter: TourChapterId | null | undefined): readonly TourStep[] {
  if (!chapter) return TOUR_STEPS;
  const only = TOUR_STEPS.filter((s) => s.chapter === chapter);
  return only.length > 0 ? only : TOUR_STEPS;
}

export function firstStepOf(chapter: TourChapterId): TourStepId {
  return stepsFor(chapter)[0].id;
}

export function stepIndex(id: TourStepId, steps: readonly TourStep[] = TOUR_STEPS): number {
  return steps.findIndex((s) => s.id === id);
}

export const TOUR_TOTAL = TOUR_STEPS.length;

/**
 * Read the merchant's position off the URL. Locale prefixes are always
 * present (`localePrefix: 'always'`), and every id is opaque here — the tour
 * only ever needs to know WHICH kind of page this is.
 */
export function placeOf(pathname: string, tabParam?: string | null): TourPlace {
  const parts = pathname.split('/').filter(Boolean);
  // Drop the locale segment when there is one; `/dashboard` alone is enough
  // to recognise the rest.
  const at = parts.indexOf('dashboard');
  if (at === -1) return { kind: 'elsewhere' };
  const rest = parts.slice(at + 1);
  if (rest.length === 0) return { kind: 'dashboard' };
  if (rest[0] !== 'sites' || rest.length < 2) return { kind: 'elsewhere' };
  const siteId = rest[1];
  if (rest.length === 2) return { kind: 'site', siteId, tab: tabOf(tabParam) };
  // `/products/new` is the creation form and `/products/<id>/edit` its
  // editor — neither renders the controls the product steps point at.
  if (rest[2] === 'products' && rest.length === 4 && rest[3] !== 'new') {
    return { kind: 'product', siteId, productId: rest[3] };
  }
  return { kind: 'elsewhere' };
}

function tabOf(raw?: string | null): SiteTab {
  return raw === 'products' || raw === 'jobs' || raw === 'integrations' || raw === 'settings'
    ? raw
    : 'overview';
}

export function fits(step: TourStep, place: TourPlace): boolean {
  if (step.where.kind === 'anywhere') return place.kind !== 'elsewhere';
  if (step.where.kind === 'dashboard') return place.kind === 'dashboard';
  if (step.where.kind === 'product') return place.kind === 'product';
  if (place.kind !== 'site') return false;
  return step.where.tab === undefined || step.where.tab === place.tab;
}

/**
 * The step to show, given where the merchant actually went.
 *
 * A tour that waits for a button the merchant already walked past is worse
 * than no tour: when the current step belongs to a page they have left, and a
 * LATER step belongs to the one they are on, the walkthrough catches up
 * instead of pointing at nothing. It never rewinds on its own — going back is
 * the merchant's decision, not ours.
 */
export function resolveStep(
  current: TourStepId,
  place: TourPlace,
  steps: readonly TourStep[] = TOUR_STEPS
): TourStepId {
  const step = steps.find((s) => s.id === current);
  if (!step) return steps[0].id;
  if (fits(step, place)) return current;
  const from = stepIndex(current, steps) + 1;
  const ahead = steps.slice(from).find((s) => s.where.kind !== 'anywhere' && fits(s, place));
  return ahead ? ahead.id : current;
}

/** Where "Next" has to go when the following step lives on another page. */
export function hrefFor(
  step: TourStep,
  ctx: { siteId?: string | null; productId?: string | null }
): string | null {
  const { siteId } = ctx;
  switch (step.where.kind) {
    case 'dashboard':
      return '/dashboard';
    case 'site':
      if (!siteId) return null;
      return step.where.tab && step.where.tab !== 'overview'
        ? `/dashboard/sites/${siteId}?tab=${step.where.tab}`
        : `/dashboard/sites/${siteId}`;
    case 'product':
      return siteId && ctx.productId
        ? `/dashboard/sites/${siteId}/products/${ctx.productId}`
        : null;
    default:
      return null;
  }
}
