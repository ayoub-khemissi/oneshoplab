import { and, eq, isNull, or, desc } from 'drizzle-orm';
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
import { db } from '@/lib/db';
import { audits, jobs, products, projects, type JobStatus } from '@/lib/db/schema';

/**
 * Bulk catalog generation — Scale plan only.
 *
 * One parent job (kind='bulk_site_generate') is inserted by
 * startBulkSiteGenerate() for the requested site. The worker then
 * processes products one-per-tick via processNextBulkProduct():
 *
 *   - text fields (title / description / tags) run synchronously via
 *     runChatOptim and complete in the same tick.
 *   - image fields fan out 3 angles via startImageOptim; kie returns
 *     async via webhook + watchdog so the parent tick doesn't wait
 *     for image completion before marking the product processed.
 *
 * Progress is tracked on the parent job's `result` field:
 *   {
 *     processed: string[],          // productId list, ordered
 *     errors: { productId, error }[],
 *     total: number,                 // initial product count
 *     totalCreditsBudget: number    // from the pre-flight estimate
 *   }
 *
 * One product per tick caps tick latency at the chat-call duration
 * (~30s) which keeps audit-watchdog / kie-watchdog from starving for
 * too long inside the same Promise.allSettled.
 */

export interface BulkInputPayload {
  siteId: string;
  productIds: string[];
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
  customInstructions: string;
}

export interface BulkResult {
  processed: string[];
  errors: Array<{ productId: string; error: string }>;
  total: number;
  totalCreditsBudget: number;
}

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

/**
 * Pre-flight cost estimate for the full bulk run. Mirrors the per-
 * product fan-out used by /api/products/generate (4 fields total) so
 * the credit budget shown to the merchant lines up with what they'll
 * actually spend.
 */
export function estimateBulkCost(
  productCount: number,
  chatModelId: ChatModelId,
  imageQualityId: ImageQualityId
): number {
  const perProduct =
    estimateChatCredits(chatModelId, 'title') +
    estimateChatCredits(chatModelId, 'description') +
    estimateChatCredits(chatModelId, 'tags') +
    costForImage(imageQualityId) * IMAGE_ANGLES.length;
  return perProduct * productCount;
}

/**
 * Find the project's currently-visible products (non-archived) for
 * the bulk run. Returns the `products.id` set in stable order so the
 * parent job's processed list, the UI, and re-runs all reference the
 * same identifiers.
 */
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

/**
 * Insert the parent bulk job row. Caller is responsible for the
 * pre-flight credit check + plan gate.
 */
export async function startBulkSiteGenerate(opts: {
  projectId: string;
  productIds: string[];
  chatModelId?: ChatModelId;
  imageQualityId?: ImageQualityId;
  customInstructions?: string;
  totalCreditsBudget: number;
}): Promise<string> {
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
    processed: [],
    errors: [],
    total: opts.productIds.length,
    totalCreditsBudget: opts.totalCreditsBudget
  };

  await db.insert(jobs).values({
    id,
    projectId: opts.projectId,
    kind: 'bulk_site_generate',
    status: 'pending',
    inputPayload: input as unknown as Record<string, unknown>,
    result: result as unknown as Record<string, unknown>,
    creditsCost: 0
  });
  return id;
}

/**
 * Single worker tick: pick one bulk job, process its next product,
 * persist progress, return.
 *
 * Returns true when work was done (so the worker can keep ticking
 * tightly), false when no bulk job is currently in flight.
 */
export async function processNextBulkProduct(): Promise<boolean> {
  // Oldest-first to drain the queue fairly and avoid starvation.
  const job = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.kind, 'bulk_site_generate'),
      or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))
    ),
    orderBy: [desc(jobs.createdAt)]
  });
  if (!job) return false;

  const input = job.inputPayload as unknown as BulkInputPayload | null;
  const result = (job.result as unknown as BulkResult | null) ?? {
    processed: [],
    errors: [],
    total: 0,
    totalCreditsBudget: 0
  };
  if (!input || !job.projectId) {
    await markJobStatus(job.id, 'failed', 'Bulk job has no input payload');
    return true;
  }

  // Flip pending → running on first touch. We also stamp startedAt so
  // the watchdog has a reference timestamp.
  if (job.status === 'pending') {
    await db
      .update(jobs)
      .set({ status: 'running' as JobStatus, startedAt: new Date() })
      .where(eq(jobs.id, job.id));
  }

  const processedSet = new Set(result.processed);
  const erroredSet = new Set(result.errors.map((e) => e.productId));
  const nextProductId = input.productIds.find(
    (id) => !processedSet.has(id) && !erroredSet.has(id)
  );

  if (!nextProductId) {
    // Nothing left to do — finalise.
    await db
      .update(jobs)
      .set({ status: 'completed' as JobStatus, finishedAt: new Date() })
      .where(eq(jobs.id, job.id));
    return true;
  }

  // Resolve the project owner so we can charge credits to them.
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, job.projectId)
  });
  if (!project) {
    await markJobStatus(job.id, 'failed', 'Project not found');
    return true;
  }

  // Pull the latest audit summary for the rich product context (bulk
  // gen reuses the same context shape that the per-product flow does).
  const audit = await db.query.audits.findFirst({
    where: or(
      eq(audits.projectId, project.id),
      and(isNull(audits.projectId), eq(audits.domain, project.domain ?? ''))
    ),
    orderBy: [desc(audits.createdAt)]
  });

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
    await appendError(job.id, result, nextProductId, 'Product row not found');
    return true;
  }

  const matched =
    all.find((p) => {
      if (productRow.sourceId && p.sourceId === productRow.sourceId) return true;
      if (productRow.handle && p.handle === productRow.handle) return true;
      return false;
    }) ?? null;
  if (!matched) {
    await appendError(
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
    await appendError(job.id, result, nextProductId, 'Product has no source id');
    return true;
  }

  const merchantInstructions = combineInstructions(
    project.customInstructions ?? null,
    productRow.customInstructions ?? input.customInstructions ?? ''
  );
  const languageCode = await getEffectiveLanguage(project.id);
  const context = toProductContext(matched);

  try {
    // Text fields run synchronously and finish within this tick.
    for (const field of ['title', 'description', 'tags'] as const) {
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
    }

    // Images fan out via kie webhook; only their startImageOptim phase
    // is awaited here. Completion lands later via /api/kie/callback.
    if (sourceImage) {
      await Promise.allSettled(
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
    }

    result.processed.push(nextProductId);
    await db
      .update(jobs)
      .set({ result: result as unknown as Record<string, unknown> })
      .where(eq(jobs.id, job.id));
  } catch (e) {
    await appendError(job.id, result, nextProductId, (e as Error).message);
  }

  return true;
}

async function appendError(
  jobId: string,
  result: BulkResult,
  productId: string,
  error: string
): Promise<void> {
  result.errors.push({ productId, error });
  await db
    .update(jobs)
    .set({ result: result as unknown as Record<string, unknown> })
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

/**
 * Read summary of the active bulk job for a site, if any. Used by the
 * dashboard banner and the bulk button to gate against double-starts.
 */
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
  const result = (job.result as unknown as BulkResult | null) ?? {
    processed: [],
    errors: [],
    total: 0,
    totalCreditsBudget: 0
  };
  return {
    id: job.id,
    status: job.status,
    total: result.total,
    processed: result.processed.length,
    errors: result.errors.length
  };
}
