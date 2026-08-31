'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getEffectiveLanguage } from '@/entities/audit';
import { getProjectCapabilities } from '@/entities/connection-capability';
import { InsufficientCreditsError } from '@/entities/credit';
import { altTextCredits, runAltTextOptim } from '@/entities/generation-job';
import { createChange } from '@/entities/product-change';
import { auth } from '@/entities/user';
import {
  ALT_BATCH_MAX_IMAGES,
  buildSetAltOps,
  planAltBatch,
  type AltCandidateImage
} from '../lib/batch';
import { canGenerateAlt, canRunAltBatch } from '../lib/capability';
import {
  listProjectProducts,
  loadOwnedProduct,
  missingAltImagesOf,
  ownsProject,
  sourceKeyOf,
  toAltProductContext
} from './context';
import type {
  AltBatchPlanResult,
  AltBatchProductResult,
  GenerateAltTextResult
} from '../model/types';

const uuid = z.string().uuid();
const imageUrl = z.string().url().max(2048);

/**
 * "Générer le texte alternatif" on one tile of the image editor. It returns
 * the sentence and STOPS: the merchant edits it if they want and queues the
 * `set_alt` op themselves. Generating and queueing in one move would put text
 * on their store that they never read.
 */
export async function generateAltTextAction(
  productId: string,
  src: string
): Promise<GenerateAltTextResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const id = uuid.safeParse(productId);
  const url = imageUrl.safeParse(src);
  if (!id.success || !url.success) return { ok: false, error: 'bad_request' };

  const row = await loadOwnedProduct(session.user.id, id.data);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.product.status === 'archived') return { ok: false, error: 'archived' };

  // A photo already on the product is a store image; anything else is one of
  // OSL's own generations, whose alt travels with it at creation time.
  const stored = (row.product.images ?? []).find((img) => img.src === url.data);
  const capabilities = await getProjectCapabilities(row.projectId);
  if (!canGenerateAlt(capabilities, stored ? 'store' : 'generated')) {
    return { ok: false, error: 'unsupported' };
  }

  const cost = altTextCredits();
  if ((session.user.creditsBalance ?? 0) < cost) {
    return { ok: false, error: 'insufficient_credits' };
  }

  try {
    const result = await runAltTextOptim({
      userId: session.user.id,
      projectId: row.projectId,
      productSourceId: sourceKeyOf(row.product),
      imageSrc: url.data,
      imageSourceImageId: stored?.sourceImageId ?? null,
      product: toAltProductContext(row.product),
      languageCode: await getEffectiveLanguage(row.projectId)
    });
    return { ok: true, alt: result.alt, creditsConsumed: result.creditsConsumed };
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return { ok: false, error: 'insufficient_credits' };
    }
    // The provider's message ("openrouter chat failed: …") never reaches the
    // merchant; the job row keeps it raw for ops.
    console.error('[generateAltTextAction]', (e as Error).message);
    return { ok: false, error: 'generation_failed' };
  }
}

/**
 * What "Générer les textes alternatifs manquants" would do, priced, before a
 * single credit moves. Refusing here is the difference between "you need 12
 * more credits" and eight alt texts followed by a failure.
 */
export async function planMissingAltTextAction(projectId: string): Promise<AltBatchPlanResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const project = uuid.safeParse(projectId);
  if (!project.success) return { ok: false, error: 'bad_request' };
  if (!(await ownsProject(session.user.id, project.data))) {
    return { ok: false, error: 'not_found' };
  }

  const capabilities = await getProjectCapabilities(project.data);
  if (!canRunAltBatch(capabilities)) return { ok: false, error: 'unsupported' };

  const rows = await listProjectProducts(project.data);
  const candidates = rows.map(missingAltImagesOf).filter((c) => c.images.length > 0);
  const plan = planAltBatch(candidates, ALT_BATCH_MAX_IMAGES);
  if (plan.images === 0) return { ok: false, error: 'nothing_missing' };

  const cost = plan.images * altTextCredits();
  if ((session.user.creditsBalance ?? 0) < cost) {
    return { ok: false, error: 'insufficient_credits' };
  }

  return {
    ok: true,
    products: plan.products.map((p) => ({
      productId: p.productId,
      title: p.title,
      images: p.images.length
    })),
    images: plan.images,
    remaining: plan.remaining,
    cost
  };
}

/**
 * One product of the batch: describe its photos that have no alt, then queue
 * ONE `images` change carrying only `set_alt` ops — so the result lands in the
 * existing pending-changes UX and nothing reaches the store unreviewed.
 *
 * Driven one product per call by the client so the progress bar tells the
 * truth and no single request holds a connection for a minute.
 */
export async function generateMissingAltForProductAction(
  productId: string
): Promise<AltBatchProductResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const id = uuid.safeParse(productId);
  if (!id.success) return { ok: false, error: 'bad_request' };

  const row = await loadOwnedProduct(session.user.id, id.data);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.product.status === 'archived') return { ok: false, error: 'archived' };

  const capabilities = await getProjectCapabilities(row.projectId);
  if (!canRunAltBatch(capabilities)) return { ok: false, error: 'unsupported' };

  const candidate = missingAltImagesOf(row.product);
  // The cap applies per call too: the client loops, and a hand-rolled caller
  // must not be able to turn one click into a whole catalog.
  const images = candidate.images.slice(0, ALT_BATCH_MAX_IMAGES);
  if (images.length === 0) return { ok: false, error: 'nothing_missing' };

  const cost = images.length * altTextCredits();
  if ((session.user.creditsBalance ?? 0) < cost) {
    return { ok: false, error: 'insufficient_credits' };
  }

  const context = toAltProductContext(row.product);
  const languageCode = await getEffectiveLanguage(row.projectId);
  const alts: Record<string, string> = {};
  let insufficient = false;
  for (const img of images) {
    if (insufficient) break;
    try {
      const result = await runAltTextOptim({
        userId: session.user.id,
        projectId: row.projectId,
        productSourceId: sourceKeyOf(row.product),
        imageSrc: img.src,
        imageSourceImageId: img.sourceImageId,
        product: context,
        languageCode
      });
      if (result.alt.length > 0) alts[img.sourceImageId] = result.alt;
    } catch (e) {
      // One photo the model choked on must not throw away the ones that
      // worked — they are already paid for. The batch reports the shortfall.
      if (e instanceof InsufficientCreditsError) insufficient = true;
      else console.error('[generateMissingAltForProductAction]', (e as Error).message);
    }
  }

  const generated = Object.keys(alts).length;
  if (generated === 0) {
    return { ok: false, error: insufficient ? 'insufficient_credits' : 'generation_failed' };
  }

  const ops = buildSetAltOps(images as AltCandidateImage[], alts);
  const created = await createChange({
    projectId: row.projectId,
    productId: row.product.id,
    productSourceId: sourceKeyOf(row.product),
    field: 'images',
    // `set_alt` never adds an image, so nothing here expires with the
    // retention window (contrast approveImageOpsAction).
    value: { v: 1, ops },
    approvedBy: session.user.id
  });
  if (!created.ok) return { ok: false, error: 'generation_failed' };

  revalidatePath(`/dashboard/sites/${row.projectId}`);
  revalidatePath(`/dashboard/sites/${row.projectId}/products/${row.product.id}`);
  return { ok: true, generated, changeQueued: true };
}
