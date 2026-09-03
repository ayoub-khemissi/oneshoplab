import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  costForImage,
  estimateChatCredits,
  type ChatModelId,
  type ImageQualityId
} from '@/entities/ai-model';
import { altTextCredits } from '@/entities/generation-job';
import { db } from '@/shared/db';
import { jobs, projects, products, users, type JobKind } from '@/shared/db/schema';
import {
  effectiveFields,
  pickBulkPrefs,
  resolveBulkPrefs,
  type BulkFieldKey,
  type ResolvedBulkPrefs
} from '../model/types';

/**
 * Single source of truth for "what should this site's bulk produce".
 * One join (project → owner) so callers (cost estimate, candidates,
 * API, the dashboard SSR seed) never disagree. `siteOverride` tells the
 * UI whether the site has its own prefs (vs. inheriting the account
 * default) so it can offer a "reset to account default" affordance.
 */
export async function getEffectiveBulkPrefs(
  projectId: string
): Promise<{ prefs: ResolvedBulkPrefs; siteOverride: boolean }> {
  const row = await db
    .select({
      sitePrefs: projects.bulkPrefs,
      userDefault: users.defaultBulkPrefs
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  const r = row[0];
  return {
    prefs: pickBulkPrefs(r?.sitePrefs ?? null, r?.userDefault ?? null),
    siteOverride: r?.sitePrefs != null
  };
}

// ---------------------------------------------------------------------------
// Cost / candidate helpers (used by both /api routes and the dashboard SSR)
// ---------------------------------------------------------------------------

/**
 * Pre-flight cost estimate for a bulk run. Mirrors the per-product
 * fan-out used by /api/products/generate so the budget shown to the
 * merchant lines up with the actual debits.
 *
 * Returns a structured breakdown so the UI can show "{N} products ×
 * ({chat} + {images} cr) = {total} cr" rather than a single opaque
 * number.
 */
export interface BulkCostBreakdown {
  productCount: number;
  perProduct: {
    chat: number;
    images: number;
    total: number;
  };
  total: number;
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
}

export function estimateBulkCostBreakdown(
  productCount: number,
  chatModelId: ChatModelId,
  imageQualityId: ImageQualityId,
  prefs?: ResolvedBulkPrefs
): BulkCostBreakdown {
  const p = prefs ?? resolveBulkPrefs(null);
  const chatPerProduct =
    (p.fields.title ? estimateChatCredits(chatModelId, 'title') : 0) +
    (p.fields.description ? estimateChatCredits(chatModelId, 'description') : 0) +
    (p.fields.tags ? estimateChatCredits(chatModelId, 'tags') : 0) +
    // Alt texts are per photo, and only for the ones that have none — the
    // estimate assumes one, which is the floor a merchant should expect
    // rather than a number that could overshoot on a product with twelve.
    (p.fields.alt ? altTextCredits() : 0);
  const imagesPerProduct = p.fields.images
    ? costForImage(imageQualityId) * p.imageAngles.length
    : 0;
  const perProductTotal = chatPerProduct + imagesPerProduct;
  return {
    productCount,
    perProduct: {
      chat: chatPerProduct,
      images: imagesPerProduct,
      total: perProductTotal
    },
    total: perProductTotal * productCount,
    chatModelId,
    imageQualityId
  };
}

/** Backwards-compat wrapper used by the page's SSR. */
export function estimateBulkCost(
  productCount: number,
  chatModelId: ChatModelId,
  imageQualityId: ImageQualityId
): number {
  return estimateBulkCostBreakdown(productCount, chatModelId, imageQualityId).total;
}

export async function listBulkCandidates(
  projectId: string
): Promise<{ id: string; sourceId: string | null; handle: string | null }[]> {
  return db
    .select({
      id: products.id,
      sourceId: products.sourceId,
      handle: products.handle
    })
    .from(products)
    .where(
      and(
        eq(products.projectId, projectId),
        or(eq(products.status, 'active'), isNull(products.status))
      )
    );
}

// ---------------------------------------------------------------------------
// "Already generated" detection
// ---------------------------------------------------------------------------

const FIELD_TO_KIND: Record<BulkFieldKey, JobKind> = {
  title: 'kie_title',
  description: 'kie_description',
  tags: 'kie_tags',
  alt: 'kie_alt_text',
  images: 'kie_image_edit'
};

const KIND_TO_FIELD: Partial<Record<JobKind, BulkFieldKey>> = {
  kie_alt_text: 'alt',
  kie_title: 'title',
  kie_description: 'description',
  kie_tags: 'tags',
  kie_image_edit: 'images'
};

/**
 * Map productSourceId → set of fields that already have a completed,
 * non-hidden generation. The bulk worker uses this per-product to skip
 * fields the merchant has already generated (by hand or in a previous
 * bulk) — bulk should never overwrite existing AI output.
 *
 * For images, only count completed image-edit jobs that actually
 * produced a persisted URL AND aren't soft-hidden by the merchant
 * (the merchant deleting their AI images is a signal they want them
 * regenerated).
 */
async function getCompletedFieldsByProduct(
  projectId: string
): Promise<Map<string, Set<BulkFieldKey>>> {
  const rows = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      inArray(jobs.kind, ['kie_title', 'kie_description', 'kie_tags', 'kie_image_edit']),
      eq(jobs.status, 'completed'),
      isNull(jobs.hiddenAt)
    )
  });

  const map = new Map<string, Set<BulkFieldKey>>();
  for (const r of rows) {
    const field = KIND_TO_FIELD[r.kind];
    if (!field) continue;
    const input = r.inputPayload as { productSourceId?: string } | null;
    const sourceId = input?.productSourceId;
    if (!sourceId) continue;
    if (field === 'images') {
      const result = r.result as { persistedUrls?: string[] } | null;
      if (!result?.persistedUrls || result.persistedUrls.length === 0) continue;
    }
    let set = map.get(sourceId);
    if (!set) {
      set = new Set();
      map.set(sourceId, set);
    }
    set.add(field);
  }
  return map;
}

/** Single-(product, field) lookup for the worker's mid-tick skip. */
export async function hasExistingCompletedField(
  projectId: string,
  productSourceId: string,
  field: BulkFieldKey
): Promise<boolean> {
  const kind = FIELD_TO_KIND[field];
  const rows = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, kind),
      eq(jobs.status, 'completed'),
      isNull(jobs.hiddenAt)
    ),
    limit: 20
  });
  for (const r of rows) {
    const input = r.inputPayload as { productSourceId?: string } | null;
    if (input?.productSourceId !== productSourceId) continue;
    if (field === 'images') {
      const result = r.result as { persistedUrls?: string[] } | null;
      if (result?.persistedUrls && result.persistedUrls.length > 0) return true;
    } else {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Candidate listing with per-field "pending" status
// ---------------------------------------------------------------------------

export interface BulkCandidate {
  id: string;
  title: string;
  /** Stable identifier used to match against jobs.inputPayload.productSourceId. */
  sourceId: string;
  /** Fields that don't yet have a completed generation. The bulk only
   *  ever touches these; an empty list means the product is fully
   *  generated and won't appear in the candidates response. */
  pendingFields: BulkFieldKey[];
  /** Sum of per-field costs for the pending fields, computed at the
   *  user's CURRENT preferred chat model + image quality. */
  pendingCost: number;
}

export async function listBulkCandidatesWithStatus(
  projectId: string,
  chatModelId: ChatModelId,
  imageQualityId: ImageQualityId
): Promise<BulkCandidate[]> {
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      sourceId: products.sourceId,
      handle: products.handle
    })
    .from(products)
    .where(
      and(
        eq(products.projectId, projectId),
        or(eq(products.status, 'active'), isNull(products.status))
      )
    );
  // Site bulk prefs gate which fields count as "pending" and how many
  // image angles are billed. Loaded here so every caller (API + the
  // dashboard SSR cost estimate) is automatically prefs-aware.
  const { prefs } = await getEffectiveBulkPrefs(projectId);
  const wanted = effectiveFields(prefs);

  const completed = await getCompletedFieldsByProduct(projectId);
  const out: BulkCandidate[] = [];

  for (const p of rows) {
    const sourceId = p.sourceId ?? p.handle ?? '';
    if (!sourceId) continue;
    const done = completed.get(sourceId) ?? new Set<BulkFieldKey>();
    // Only fields the merchant asked for AND that aren't already done.
    const pending = wanted.filter((f) => !done.has(f));
    if (pending.length === 0) continue;
    let cost = 0;
    for (const f of pending) {
      cost +=
        f === 'images'
          ? costForImage(imageQualityId) * prefs.imageAngles.length
          : estimateChatCredits(chatModelId, f);
    }
    out.push({
      id: p.id,
      title: p.title,
      sourceId,
      pendingFields: pending,
      pendingCost: cost
    });
  }
  return out;
}
