import { and, asc, eq, inArray, isNull, lt, or, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  CHAT_MODEL_REGISTRY,
  costForImage,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_QUALITY,
  estimateChatCredits,
  IMAGE_MODEL_REGISTRY,
  buildImagePrompt,
  IMAGE_ANGLES,
  runChatOptim,
  startImageOptim,
  type ChatModelId,
  type ImageQualityId,
  type ProductContext
} from '@/lib/ai';
import { getEffectiveLanguage } from '@/lib/audit/language';
import { InsufficientCreditsError } from '@/lib/credits';
import { db } from '@/lib/db';
import {
  audits,
  jobs,
  projects,
  products,
  type JobKind,
  type JobStatus
} from '@/lib/db/schema';

/**
 * Bulk catalog generation — Scale plan only.
 *
 * Lifecycle:
 *
 *   1. startBulkSiteGenerate(): inserts the parent job (kind=
 *      bulk_site_generate) inside a DB transaction so a double-click
 *      can't insert two rows for the same site.
 *
 *   2. processNextBulkProduct() ticks once per worker iteration,
 *      FIFO-draining the oldest pending/running bulk. Each tick:
 *        - re-checks the parent's status (cancellation can land between
 *          ticks; we bail mid-product gracefully if status flipped)
 *        - finds the next product whose perProduct entry isn't fully
 *          terminal yet
 *        - runs each chat field (title/desc/tags) and the image fan-out
 *          INDEPENDENTLY: a single field that errors marks ONLY that
 *          field as failed; other fields still try, so a partial
 *          product is recorded as such. This is the "atomic" failure
 *          granularity — one field per product, not the whole chain.
 *        - persists per-field outcome on the parent's `result.perProduct`
 *          BEFORE moving to the next field, so a worker crash mid-
 *          product picks up where it left off without re-running (and
 *          re-billing) work that already succeeded.
 *
 *   3. cancelBulkJob() flips a non-terminal job to status='failed' with
 *      error='cancelled_by_user'. The next tick's status guard skips
 *      it; in-flight work in the current tick finishes and persists
 *      whatever it had time to do.
 *
 *   4. runBulkWatchdog() is invoked from the worker tick alongside the
 *      kie watchdog. Any bulk in 'running' that hasn't touched its
 *      result in BULK_STALL_TIMEOUT_MS gets force-failed.
 */

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

const ALL_FIELDS: BulkFieldKey[] = ['title', 'description', 'tags', 'images'];

interface ProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

interface SummaryProduct {
  sourceId: string | null;
  handle: string | null;
  title: string;
  descriptionHtml: string;
  images: ProductImage[];
  signals: {
    tags?: string[];
    vendor?: string | null;
    productType?: string | null;
    priceMin?: number | null;
    priceMax?: number | null;
  };
}

interface SummaryShape {
  worstProducts?: SummaryProduct[];
  latestProducts?: SummaryProduct[];
  bestProducts?: SummaryProduct[];
  allProducts?: SummaryProduct[];
}

const FIELD_DEFAULT_PROMPT = {
  title:
    'Rewrite this title to be SEO-optimised, keyword-front-loaded and more compelling. Stay factually consistent with the product.',
  description:
    'Rewrite this description as benefit-led, scannable HTML (use <p>, <ul>, <li>, <strong>). 180-350 words. Stay factually consistent with the product.',
  tags: 'Suggest 5-10 customer-facing discovery tags for this product.'
} as const;

function effectiveChatPrompt(
  field: 'title' | 'description' | 'tags',
  custom: string
): string {
  const trimmed = custom.trim();
  return trimmed
    ? `${FIELD_DEFAULT_PROMPT[field]}\n\nAdditional instructions from the merchant:\n${trimmed}`
    : FIELD_DEFAULT_PROMPT[field];
}

function combineInstructions(
  projectInstructions: string | null,
  productInstructions: string
): string {
  const parts: string[] = [];
  if (projectInstructions && projectInstructions.trim()) {
    parts.push(`Site-wide brand guidance:\n${projectInstructions.trim()}`);
  }
  if (productInstructions && productInstructions.trim()) {
    parts.push(`Product-specific guidance:\n${productInstructions.trim()}`);
  }
  return parts.join('\n\n');
}

function toProductContext(p: SummaryProduct): ProductContext {
  const text = p.descriptionHtml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return {
    title: p.title,
    descriptionText: text,
    vendor: p.signals.vendor ?? null,
    productType: p.signals.productType ?? null,
    tags: p.signals.tags ?? [],
    imageCount: p.images.length,
    priceMin: p.signals.priceMin ?? null,
    priceMax: p.signals.priceMax ?? null,
    currency: null
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
  imageQualityId: ImageQualityId
): BulkCostBreakdown {
  const chatPerProduct =
    estimateChatCredits(chatModelId, 'title') +
    estimateChatCredits(chatModelId, 'description') +
    estimateChatCredits(chatModelId, 'tags');
  const imagesPerProduct = costForImage(imageQualityId) * IMAGE_ANGLES.length;
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

export async function listBulkCandidates(projectId: string): Promise<
  { id: string; sourceId: string | null; handle: string | null }[]
> {
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
  images: 'kie_image_edit'
};

const KIND_TO_FIELD: Partial<Record<JobKind, BulkFieldKey>> = {
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
async function hasExistingCompletedField(
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
  const completed = await getCompletedFieldsByProduct(projectId);
  const out: BulkCandidate[] = [];

  for (const p of rows) {
    const sourceId = p.sourceId ?? p.handle ?? '';
    if (!sourceId) continue;
    const done = completed.get(sourceId) ?? new Set<BulkFieldKey>();
    const pending = ALL_FIELDS.filter((f) => !done.has(f));
    if (pending.length === 0) continue;
    let cost = 0;
    for (const f of pending) {
      cost +=
        f === 'images'
          ? costForImage(imageQualityId) * IMAGE_ANGLES.length
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

// ---------------------------------------------------------------------------
// Start / cancel
// ---------------------------------------------------------------------------

/**
 * Insert the parent bulk job atomically. The (existence-check, insert)
 * pair runs inside a DB transaction so two concurrent submits can't
 * each see "no active bulk" and both insert. The second one finds the
 * first inside the same transaction window and returns an error that
 * the API route surfaces as 409.
 */
export async function startBulkSiteGenerate(opts: {
  projectId: string;
  productIds: string[];
  chatModelId?: ChatModelId;
  imageQualityId?: ImageQualityId;
  customInstructions?: string;
  totalCreditsBudget: number;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: 'already_running' }> {
  const id = randomUUID();
  const chatModelId =
    opts.chatModelId && opts.chatModelId in CHAT_MODEL_REGISTRY
      ? opts.chatModelId
      : DEFAULT_CHAT_MODEL;
  const imageQualityId =
    opts.imageQualityId && opts.imageQualityId in IMAGE_MODEL_REGISTRY
      ? opts.imageQualityId
      : DEFAULT_IMAGE_QUALITY;

  const input: BulkInputPayload = {
    siteId: opts.projectId,
    productIds: opts.productIds,
    chatModelId,
    imageQualityId,
    customInstructions: opts.customInstructions ?? ''
  };
  const result: BulkResult = {
    total: opts.productIds.length,
    totalCreditsBudget: opts.totalCreditsBudget,
    lastProgressAtMs: null,
    perProduct: {}
  };

  const inserted = await db.transaction(async (tx) => {
    const existing = await tx.query.jobs.findFirst({
      where: and(
        eq(jobs.projectId, opts.projectId),
        eq(jobs.kind, 'bulk_site_generate'),
        or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))
      )
    });
    if (existing) return null;
    await tx.insert(jobs).values({
      id,
      projectId: opts.projectId,
      kind: 'bulk_site_generate',
      status: 'pending',
      inputPayload: input as unknown as Record<string, unknown>,
      result: result as unknown as Record<string, unknown>,
      creditsCost: 0
    });
    return id;
  });

  if (!inserted) return { ok: false, reason: 'already_running' };
  return { ok: true, jobId: inserted };
}

/**
 * Take a bulk job that ended (any terminal state) and queue a new
 * one targeting only the productIds whose previous run had at least
 * one field error. Combined with the worker's per-field skip, this
 * means the retry only re-attempts the actually-failed fields and
 * doesn't re-bill the ones that succeeded.
 *
 * Uses the same atomic-insert path as a fresh start, so it 409s if
 * a bulk is already running for the same site.
 */
export async function retryFailedFromBulk(opts: {
  projectId: string;
  sourceJobId: string;
  chatModelId?: ChatModelId;
  imageQualityId?: ImageQualityId;
  customInstructions?: string;
  totalCreditsBudget: number;
}): Promise<
  | { ok: true; jobId: string; productCount: number }
  | { ok: false; reason: 'already_running' | 'source_not_found' | 'no_failures' }
> {
  const source = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.id, opts.sourceJobId),
      eq(jobs.projectId, opts.projectId),
      eq(jobs.kind, 'bulk_site_generate')
    )
  });
  if (!source) return { ok: false, reason: 'source_not_found' };

  const sourceResult = readResult(source.result);
  const failedProductIds = Object.entries(sourceResult.perProduct)
    .filter(([, state]) =>
      Object.values(state.fields).some((v) => v && v !== 'done')
    )
    .map(([id]) => id);
  if (failedProductIds.length === 0) {
    return { ok: false, reason: 'no_failures' };
  }

  const out = await startBulkSiteGenerate({
    projectId: opts.projectId,
    productIds: failedProductIds,
    chatModelId: opts.chatModelId,
    imageQualityId: opts.imageQualityId,
    customInstructions: opts.customInstructions,
    totalCreditsBudget: opts.totalCreditsBudget
  });
  if (!out.ok) return { ok: false, reason: 'already_running' };
  return { ok: true, jobId: out.jobId, productCount: failedProductIds.length };
}

/**
 * Cancel an in-flight bulk job. Best-effort: any per-field work
 * already committed in the current tick is kept (the credit ledger
 * and chat job rows are independent and durable). Future ticks see
 * the cancelled status and skip this row.
 */
export async function cancelBulkJob(jobId: string, projectId: string): Promise<boolean> {
  const result = await db
    .update(jobs)
    .set({
      status: 'failed',
      error: 'cancelled_by_user',
      finishedAt: new Date()
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.projectId, projectId),
        eq(jobs.kind, 'bulk_site_generate'),
        or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))
      )
    );
  // mysql2 returns affectedRows in the result header; a 0-affected
  // update means the job was already terminal (completed / earlier
  // cancel). We treat that as "no-op success" — caller doesn't care.
  return result != null;
}

// ---------------------------------------------------------------------------
// Worker tick
// ---------------------------------------------------------------------------

/**
 * Worker tick. Returns true when work happened (caller can keep
 * ticking tightly), false when nothing was queued.
 */
export async function processNextBulkProduct(): Promise<boolean> {
  // FIFO so the oldest queued bulk drains first; older bug picked the
  // newest, which let a freshly-launched bulk leapfrog an in-flight
  // one for another site.
  const job = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.kind, 'bulk_site_generate'),
      or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))
    ),
    orderBy: [asc(jobs.createdAt)]
  });
  if (!job) return false;

  const input = job.inputPayload as unknown as BulkInputPayload | null;
  const result = readResult(job.result);
  if (!input || !job.projectId) {
    await markJobStatus(job.id, 'failed', 'Bulk job has no input payload');
    return true;
  }

  // Flip pending → running on first touch and stamp progressAt so the
  // stall watchdog has a reference.
  if (job.status === 'pending') {
    result.lastProgressAtMs = Date.now();
    await db
      .update(jobs)
      .set({
        status: 'running' as JobStatus,
        startedAt: new Date(),
        result: result as unknown as Record<string, unknown>
      })
      .where(eq(jobs.id, job.id));
  }

  // Find the next product not yet fully attempted (every field has
  // either 'done' or { error } recorded).
  const nextProductId = input.productIds.find((pid) => {
    const state = result.perProduct[pid];
    if (!state) return true;
    return ALL_FIELDS.some((f) => !(f in state.fields));
  });

  if (!nextProductId) {
    await markJobStatus(job.id, 'completed');
    return true;
  }

  // Resolve project + product context.
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, job.projectId)
  });
  if (!project) {
    await markJobStatus(job.id, 'failed', 'Project not found');
    return true;
  }

  const { findLatestAuditForProject } = await import('../audit/find-latest');
  const audit = await findLatestAuditForProject(project.id, project.domain);

  const summary = (audit?.summary ?? null) as SummaryShape | null;
  const all: SummaryProduct[] = summary
    ? [
        ...(summary.allProducts ?? []),
        ...(summary.worstProducts ?? []),
        ...(summary.latestProducts ?? []),
        ...(summary.bestProducts ?? [])
      ]
    : [];

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, nextProductId), eq(products.projectId, project.id))
  });
  if (!productRow) {
    await markFieldsErrored(
      job.id,
      result,
      nextProductId,
      'Product row not found'
    );
    return true;
  }

  const matched =
    all.find((p) => {
      if (productRow.sourceId && p.sourceId === productRow.sourceId) return true;
      if (productRow.handle && p.handle === productRow.handle) return true;
      return false;
    }) ?? null;
  if (!matched) {
    await markFieldsErrored(
      job.id,
      result,
      nextProductId,
      'Product missing from latest audit summary — relaunch the audit before bulking'
    );
    return true;
  }
  const sourceId = matched.sourceId ?? matched.handle ?? '';
  const sourceImage = matched.images[0]?.src ?? null;
  if (!sourceId) {
    await markFieldsErrored(job.id, result, nextProductId, 'Product has no source id');
    return true;
  }

  const merchantInstructions = combineInstructions(
    project.customInstructions ?? null,
    productRow.customInstructions ?? input.customInstructions ?? ''
  );
  const languageCode = await getEffectiveLanguage(project.id);
  const context = toProductContext(matched);

  const state: BulkProductState = result.perProduct[nextProductId] ?? { fields: {} };
  result.perProduct[nextProductId] = state;

  // Process each field independently — atomic failure granularity.
  // After each field, persist + re-check parent status so a cancel
  // request lands quickly. If credits run out, mark the remaining
  // fields as errored with a clear message and stop the bulk.
  for (const field of ALL_FIELDS) {
    if (field in state.fields) continue;

    // Cancellation re-check between fields. The status was loaded at
    // the top of the tick; could have flipped via DELETE since.
    const fresh = await db.query.jobs.findFirst({
      where: eq(jobs.id, job.id),
      columns: { status: true, error: true }
    });
    if (
      !fresh ||
      (fresh.status !== 'running' && fresh.status !== 'pending')
    ) {
      // Cancelled or already finalised by another path; bail without
      // touching the row further.
      return true;
    }

    // Skip fields that already have a non-hidden completed generation
    // (created by a per-product action, an earlier bulk, or this bulk
    // before it crashed). Bulk never overwrites existing AI output —
    // its job is to fill the gaps, not to re-pay for work already done.
    if (await hasExistingCompletedField(project.id, sourceId, field)) {
      state.fields[field] = 'done';
      result.lastProgressAtMs = Date.now();
      await db
        .update(jobs)
        .set({ result: result as unknown as Record<string, unknown> })
        .where(eq(jobs.id, job.id));
      continue;
    }

    try {
      if (field === 'images') {
        if (!sourceImage) {
          state.fields.images = { error: 'No source image on this product' };
        } else {
          const settled = await Promise.allSettled(
            IMAGE_ANGLES.map((angle) =>
              startImageOptim({
                userId: project.userId,
                projectId: project.id,
                productSourceId: sourceId,
                sourceImageUrl: sourceImage,
                userPrompt: buildImagePrompt(angle, '', merchantInstructions),
                appUrl: process.env.APP_URL,
                imageQualityId: input.imageQualityId
              })
            )
          );
          const allFailed = settled.every((s) => s.status === 'rejected');
          if (allFailed) {
            const reason =
              (settled.find((s) => s.status === 'rejected') as
                | PromiseRejectedResult
                | undefined)?.reason ?? null;
            const message =
              reason instanceof Error ? reason.message : 'Image fan-out failed';
            state.fields.images = { error: message };
          } else {
            state.fields.images = 'done';
          }
        }
      } else {
        await runChatOptim({
          userId: project.userId,
          projectId: project.id,
          productSourceId: sourceId,
          field,
          userPrompt: effectiveChatPrompt(field, merchantInstructions),
          product: context,
          chatModelId: input.chatModelId,
          languageCode
        });
        state.fields[field] = 'done';
      }
    } catch (e) {
      // Insufficient credits is the one error worth aborting the entire
      // bulk for — every subsequent product / field will hit the same
      // wall. Mark this field + everything still pending as errored,
      // flip the bulk to failed, and exit.
      if (e instanceof InsufficientCreditsError) {
        state.fields[field] = { error: 'insufficient_credits' };
        await stopBulkOnInsufficient(job.id, result);
        return true;
      }
      const msg = (e as Error).message ?? 'Unknown error';
      state.fields[field] = { error: msg };
    }

    result.lastProgressAtMs = Date.now();
    await db
      .update(jobs)
      .set({ result: result as unknown as Record<string, unknown> })
      .where(eq(jobs.id, job.id));
  }

  return true;
}

// ---------------------------------------------------------------------------
// Stall watchdog
// ---------------------------------------------------------------------------

/**
 * Reaper for bulks stuck in 'running' that haven't written progress
 * within BULK_STALL_TIMEOUT_MS. Runs once per worker tick alongside
 * kie-watchdog; cheap when nothing is stuck.
 */
export async function runBulkWatchdog(): Promise<void> {
  const stuck = await db.query.jobs.findMany({
    where: and(
      eq(jobs.kind, 'bulk_site_generate'),
      eq(jobs.status, 'running'),
      lt(jobs.startedAt, new Date(Date.now() - BULK_STALL_TIMEOUT_MS))
    ),
    limit: 5
  });
  if (stuck.length === 0) return;

  for (const job of stuck) {
    const result = readResult(job.result);
    const lastProgress = result.lastProgressAtMs ?? job.startedAt?.getTime() ?? 0;
    if (Date.now() - lastProgress < BULK_STALL_TIMEOUT_MS) continue;
    console.warn(
      `[bulk-watchdog] reaping stalled bulk ${job.id} (no progress for ${
        (Date.now() - lastProgress) / 1000
      }s)`
    );
    await markJobStatus(job.id, 'failed', 'bulk_stalled');
  }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

function readResult(raw: unknown): BulkResult {
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
    totalCreditsBudget:
      typeof value.totalCreditsBudget === 'number' ? value.totalCreditsBudget : 0,
    lastProgressAtMs:
      typeof value.lastProgressAtMs === 'number' ? value.lastProgressAtMs : null,
    perProduct: (value.perProduct as Record<string, BulkProductState>) ?? {}
  };
}

async function markFieldsErrored(
  jobId: string,
  result: BulkResult,
  productId: string,
  error: string
): Promise<void> {
  const state: BulkProductState = result.perProduct[productId] ?? { fields: {} };
  for (const f of ALL_FIELDS) {
    if (!(f in state.fields)) state.fields[f] = { error };
  }
  result.perProduct[productId] = state;
  result.lastProgressAtMs = Date.now();
  await db
    .update(jobs)
    .set({ result: result as unknown as Record<string, unknown> })
    .where(eq(jobs.id, jobId));
}

async function stopBulkOnInsufficient(
  jobId: string,
  result: BulkResult
): Promise<void> {
  result.lastProgressAtMs = Date.now();
  await db
    .update(jobs)
    .set({
      status: 'failed' as JobStatus,
      error: 'insufficient_credits',
      finishedAt: new Date(),
      result: result as unknown as Record<string, unknown>
    })
    .where(eq(jobs.id, jobId));
}

async function markJobStatus(
  jobId: string,
  status: JobStatus,
  errorText?: string
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status,
      finishedAt: new Date(),
      ...(errorText ? { error: errorText } : {})
    })
    .where(eq(jobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Status / progress accessors for the UI
// ---------------------------------------------------------------------------

export interface BulkJobStatusForUi {
  id: string;
  status: JobStatus;
  error: string | null;
  total: number;
  /** All four fields recorded as 'done'. */
  fullySucceeded: number;
  /** Mix of 'done' and { error } across the four fields. */
  partiallySucceeded: number;
  /** All four fields errored. */
  fullyFailed: number;
  /** Sum of products with at least one field still missing. */
  notYetAttempted: number;
  /** Per-product detail so the UI can render the failure modal. */
  perProduct: Record<string, BulkProductState>;
}

function aggregate(result: BulkResult, total: number): {
  fullySucceeded: number;
  partiallySucceeded: number;
  fullyFailed: number;
  notYetAttempted: number;
} {
  let fullySucceeded = 0;
  let partiallySucceeded = 0;
  let fullyFailed = 0;
  for (const state of Object.values(result.perProduct)) {
    const present = ALL_FIELDS.filter((f) => f in state.fields);
    if (present.length < ALL_FIELDS.length) continue;
    const doneCount = present.filter((f) => state.fields[f] === 'done').length;
    if (doneCount === ALL_FIELDS.length) fullySucceeded++;
    else if (doneCount === 0) fullyFailed++;
    else partiallySucceeded++;
  }
  const attempted = fullySucceeded + partiallySucceeded + fullyFailed;
  return {
    fullySucceeded,
    partiallySucceeded,
    fullyFailed,
    notYetAttempted: Math.max(0, total - attempted)
  };
}

/** Active (non-terminal) bulk for a site, if any. */
export async function getActiveBulkJob(projectId: string): Promise<{
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  errors: number;
} | null> {
  const job = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, 'bulk_site_generate'),
      or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))
    ),
    orderBy: [desc(jobs.createdAt)]
  });
  if (!job) return null;
  const result = readResult(job.result);
  const agg = aggregate(result, result.total);
  // For the simple progress bar we count attempts of any kind.
  const processed = agg.fullySucceeded + agg.partiallySucceeded + agg.fullyFailed;
  const errors = agg.partiallySucceeded + agg.fullyFailed;
  return {
    id: job.id,
    status: job.status,
    total: result.total,
    processed,
    errors
  };
}

/** Most recent bulk for a site (any status), with full per-product
 *  state for the failure-detail modal. */
export async function getLatestBulkJobDetail(
  projectId: string
): Promise<BulkJobStatusForUi | null> {
  const job = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, 'bulk_site_generate')
    ),
    orderBy: [desc(jobs.createdAt)]
  });
  if (!job) return null;
  const result = readResult(job.result);
  const agg = aggregate(result, result.total);
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    total: result.total,
    perProduct: result.perProduct,
    ...agg
  };
}
