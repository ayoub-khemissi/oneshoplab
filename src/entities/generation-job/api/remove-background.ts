import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction, InsufficientCreditsError } from '@/entities/credit';
import { persistKieJobFailure } from './job-failure';
import { db } from '@/shared/db';
import { jobs, products, users } from '@/shared/db/schema';
import { transitionJob } from './transitions';
import { buildKieCallbackUrl, getKieClient } from '@/entities/ai-provider';
import { costForRemoveBackground, REMOVE_BACKGROUND_TOOL } from '@/entities/ai-model';

/** Marker in `inputPayload.op` that tells every image-job consumer this row
 *  is a cut-out of an existing picture, not a generation. */
export const REMOVE_BG_OP = 'remove_bg' as const;

/** kie's documented input envelope for recraft/remove-background. */
export const REMOVE_BG_MAX_DIMENSION = 4096;
export const REMOVE_BG_MIN_DIMENSION = 256;

export interface StartRemoveBackgroundOptions {
  userId: string;
  projectId: string;
  productSourceId: string;
  /** Public https URL of the picture to cut out — an R2 generation or one of
   *  the product's own store images. */
  sourceImageUrl: string;
  /** Generation this cut-out derives from, when the source is one of ours. */
  sourceJobId?: string | null;
  /** Alt text of the source, carried over: the subject has not changed. */
  sourceAlt?: string | null;
  appUrl?: string;
  silent?: boolean;
}

export interface StartRemoveBackgroundResult {
  jobId: string;
  kieTaskId: string;
  creditsHeld: number;
}

/**
 * Kick off a background removal on kie (Recraft). Same lifecycle as
 * startImageOptim — hold credits, insert a `kie_image_edit` row, createTask
 * with our webhook — so the grid, the watchdog, retention, apply-to-store and
 * the refund path all treat the result as one more image of the product.
 * `inputPayload.op = 'remove_bg'` is what makes persist-result store it as a
 * normalised transparent PNG and skip the alt pass.
 */
export async function startRemoveBackground(
  opts: StartRemoveBackgroundOptions
): Promise<StartRemoveBackgroundResult> {
  const cost = costForRemoveBackground();

  const user = await db.query.users.findFirst({ where: eq(users.id, opts.userId) });
  if (!user) throw new Error(`User ${opts.userId} not found`);
  if (user.creditsBalance < cost) {
    throw new InsufficientCreditsError(cost, user.creditsBalance);
  }

  const jobId = randomUUID();
  const callBackUrl = buildKieCallbackUrl(opts.appUrl);

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.projectId, opts.projectId), eq(products.sourceId, opts.productSourceId)),
    columns: { id: true }
  });

  await db.insert(jobs).values({
    id: jobId,
    projectId: opts.projectId,
    productId: productRow?.id ?? null,
    kind: 'kie_image_edit',
    status: 'pending',
    inputPayload: {
      productSourceId: opts.productSourceId,
      field: 'images',
      op: REMOVE_BG_OP,
      // Shown where a generation shows its prompt; no fallback model reads it
      // (tryImageFallback needs a prompt to re-generate, and a cut-out has
      // nothing to re-generate), so a failure goes straight to refund.
      userPrompt: '',
      sourceImageUrl: opts.sourceImageUrl,
      ...(opts.sourceJobId ? { sourceJobId: opts.sourceJobId } : {}),
      ...(opts.sourceAlt ? { sourceAlt: opts.sourceAlt } : {}),
      ...(opts.silent ? { silent: true } : {})
    },
    creditsCost: cost,
    startedAt: new Date()
  });

  try {
    await applyCreditTransaction({
      userId: opts.userId,
      delta: -cost,
      reason: 'kie_image_edit',
      jobId,
      idempotencyKey: `job-${jobId}`
    });
  } catch (e) {
    await db.delete(jobs).where(eq(jobs.id, jobId));
    throw e;
  }

  const kie = getKieClient();
  try {
    const { taskId } = await kie.createTask({
      model: REMOVE_BACKGROUND_TOOL.kieModelId,
      input: { image: opts.sourceImageUrl },
      ...(callBackUrl ? { callBackUrl } : {})
    });
    await transitionJob(db, jobId, 'running', { kieTaskId: taskId });
    return { jobId, kieTaskId: taskId, creditsHeld: cost };
  } catch (e) {
    await persistKieJobFailure(jobId, 'kie_image_edit', (e as Error).message, 'kie_create_failed');
    throw e;
  }
}

/** Input payload shape shared by persist-result and the grid mapper. */
export interface RemoveBgInput {
  op?: string;
  sourceJobId?: string;
  sourceAlt?: string;
  sourceImageUrl?: string;
  thenRemoveBg?: boolean;
}

export function isRemoveBgInput(input: unknown): boolean {
  return (input as RemoveBgInput | null)?.op === REMOVE_BG_OP;
}
