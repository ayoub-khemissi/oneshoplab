import type { ChatModelId, ImageQualityId } from '@/lib/ai';

export const BULK_STALL_TIMEOUT_MS = 15 * 60_000;

export type BulkFieldKey = 'title' | 'description' | 'tags' | 'images';

export type BulkFieldOutcome = 'done' | { error: string };

export interface BulkProductState {
  /** Per-field outcome. Absence = not attempted yet. */
  fields: Partial<Record<BulkFieldKey, BulkFieldOutcome>>;
}

export interface BulkInputPayload {
  siteId: string;
  productIds: string[];
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
  customInstructions: string;
  /** Snapshot of the site's bulk prefs at launch. Absent on jobs
   *  queued before this feature → resolveBulkPrefs() treats it as the
   *  legacy "everything on, 3 angles" default. */
  fields?: Record<BulkFieldKey, boolean>;
  imageAngles?: BulkImageAngle[];
}

export interface BulkResult {
  total: number;
  totalCreditsBudget: number;
  /** Last time the worker wrote progress — drives the stall watchdog. */
  lastProgressAtMs: number | null;
  /** Per-product field map. Stays the same shape across ticks so the
   *  worker can resume cleanly. */
  perProduct: Record<string, BulkProductState>;
}

export const ALL_FIELDS: BulkFieldKey[] = ['title', 'description', 'tags', 'images'];

export type BulkImageAngle = 'lifestyle' | 'studio' | 'inuse';
const ALL_ANGLES: BulkImageAngle[] = ['lifestyle', 'studio', 'inuse'];

export interface ResolvedBulkPrefs {
  fields: Record<BulkFieldKey, boolean>;
  imageAngles: BulkImageAngle[];
}

/**
 * Normalize a stored projects.bulkPrefs (or null / a job-payload
 * snapshot) into a complete, sanitized prefs object. NULL / legacy =
 * everything on, all 3 image angles — so sites without saved prefs and
 * bulk jobs queued before this feature behave exactly as before.
 */
export function resolveBulkPrefs(raw: unknown): ResolvedBulkPrefs {
  const r = (raw ?? null) as {
    fields?: Partial<Record<BulkFieldKey, unknown>>;
    imageAngles?: unknown;
  } | null;
  const f = r?.fields ?? {};
  const fields: Record<BulkFieldKey, boolean> = {
    title: f.title !== false,
    description: f.description !== false,
    tags: f.tags !== false,
    images: f.images !== false
  };
  const rawAngles = Array.isArray(r?.imageAngles) ? r.imageAngles : null;
  let imageAngles = rawAngles
    ? ALL_ANGLES.filter((a) => rawAngles.includes(a))
    : ALL_ANGLES.slice();
  // Images on but no angle picked would mean "images, zero images" —
  // nonsensical; fall back to all 3 (the UI also prevents this).
  if (fields.images && imageAngles.length === 0) {
    imageAngles = ALL_ANGLES.slice();
  }
  return { fields, imageAngles };
}

/** Fields the bulk will actually touch given prefs (order preserved). */
export function effectiveFields(prefs: ResolvedBulkPrefs): BulkFieldKey[] {
  return ALL_FIELDS.filter((f) => prefs.fields[f]);
}

/**
 * Resolution chain: a site's own prefs win; otherwise the owner's
 * account-wide default; otherwise the legacy "everything on" default.
 * `null` means "not set" at that level (inherit downward).
 */
export function pickBulkPrefs(siteRaw: unknown, userDefaultRaw: unknown): ResolvedBulkPrefs {
  if (siteRaw != null) return resolveBulkPrefs(siteRaw);
  if (userDefaultRaw != null) return resolveBulkPrefs(userDefaultRaw);
  return resolveBulkPrefs(null);
}

export function readResult(raw: unknown): BulkResult {
  const value = (raw as BulkResult | null) ?? null;
  if (
    !value ||
    typeof value !== 'object' ||
    !('perProduct' in value) ||
    typeof value.perProduct !== 'object'
  ) {
    return {
      total: 0,
      totalCreditsBudget: 0,
      lastProgressAtMs: null,
      perProduct: {}
    };
  }
  return {
    total: typeof value.total === 'number' ? value.total : 0,
    totalCreditsBudget: typeof value.totalCreditsBudget === 'number' ? value.totalCreditsBudget : 0,
    lastProgressAtMs: typeof value.lastProgressAtMs === 'number' ? value.lastProgressAtMs : null,
    perProduct: (value.perProduct as Record<string, BulkProductState>) ?? {}
  };
}
