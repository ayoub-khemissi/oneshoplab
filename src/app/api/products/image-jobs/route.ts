import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { MAX_IMAGES_PER_PRODUCT } from '@/features/generate-product-images';
import { buildImagePrompt, IMAGE_ANGLES, startImageOptim } from '@/entities/generation-job';
import {
  costForImage,
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODEL_REGISTRY,
  type ImageQualityId
} from '@/entities/ai-model';
import { listProductImageJobs, persistKieJobFailure } from '@/entities/generation-job';
import { auth } from '@/entities/user';
import { InsufficientCreditsError } from '@/entities/credit';
import { db } from '@/lib/db';
import { jobs, products, projects } from '@/lib/db/schema';
import { sanitizeUserFacingError } from '@/lib/errors';

interface ProductImage {
  src: string;
}

interface ProductSnapshot {
  sourceId: string | null;
  handle: string | null;
  images: ProductImage[];
}

interface SummaryShape {
  worstProducts?: ProductSnapshot[];
  latestProducts?: ProductSnapshot[];
  bestProducts?: ProductSnapshot[];
  allProducts?: ProductSnapshot[];
}

interface OwnedContext {
  userId: string;
  projectId: string;
  productSourceId: string;
  sourceImage: string | null;
  projectInstructions: string;
  productInstructions: string;
}

/**
 * Validate (siteId, productId) belongs to the signed-in user and pull
 * the small set of fields the image-jobs endpoints actually need:
 * - the canonical sourceId (for matching kie webhook results)
 * - the first source image url (input for kie image-edit)
 * - the project + product custom instructions (appended to the prompt)
 *
 * Returns null on missing / unowned / archived. The full product
 * snapshot lives in the audit summary; we only read the images array
 * here so we don't pay the JSON-parse cost on the hot polling path.
 */
async function loadOwnedContext(
  userId: string,
  siteId: string,
  productId: string
): Promise<OwnedContext | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.id, siteId))
  });
  if (!project) return null;

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, project.id))
  });
  if (!productRow) return null;

  const sourceId = productRow.sourceId ?? productRow.handle ?? '';
  if (!sourceId) return null;

  // Find the source image. Prefer the live audit summary (which carries
  // the freshest scrape), fall back to the persisted productRow.images.
  let sourceImage: string | null = null;
  const { findLatestAuditForProject } = await import('@/entities/audit');
  const audit = await findLatestAuditForProject(project.id, project.domain);
  if (audit?.summary) {
    const summary = audit.summary as SummaryShape;
    const all = [
      ...(summary.allProducts ?? []),
      ...(summary.worstProducts ?? []),
      ...(summary.latestProducts ?? []),
      ...(summary.bestProducts ?? [])
    ];
    const match = all.find((p) => {
      if (productRow.sourceId && p.sourceId === productRow.sourceId) return true;
      if (productRow.handle && p.handle === productRow.handle) return true;
      return false;
    });
    sourceImage = match?.images?.[0]?.src ?? null;
  }
  if (!sourceImage) {
    const persisted = (productRow.images ?? []) as ProductImage[];
    sourceImage = persisted[0]?.src ?? null;
  }

  return {
    userId,
    projectId: project.id,
    productSourceId: sourceId,
    sourceImage,
    projectInstructions: project.customInstructions ?? '',
    productInstructions: productRow.customInstructions ?? ''
  };
}

function combineInstructions(projectInstructions: string, productInstructions: string): string {
  const parts: string[] = [];
  if (projectInstructions.trim()) {
    parts.push(`Site-wide brand guidance:\n${projectInstructions.trim()}`);
  }
  if (productInstructions.trim()) {
    parts.push(`Product-specific guidance:\n${productInstructions.trim()}`);
  }
  return parts.join('\n\n');
}

function imageQualityFromBody(raw: unknown, preferred: string | null | undefined): ImageQualityId {
  if (typeof raw === 'string' && raw in IMAGE_MODEL_REGISTRY) {
    return raw as ImageQualityId;
  }
  if (preferred && preferred in IMAGE_MODEL_REGISTRY) {
    return preferred as ImageQualityId;
  }
  return DEFAULT_IMAGE_QUALITY;
}

// ---------------------------------------------------------------------------
// GET — list visible image jobs for one product (used by the polling client).
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const siteId = url.searchParams.get('siteId') ?? '';
  const productId = url.searchParams.get('productId') ?? '';
  if (!siteId || !productId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const ctx = await loadOwnedContext(session.user.id, siteId, productId);
  if (!ctx) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }

  const rows = await listProductImageJobs(ctx.projectId, ctx.productSourceId);
  return NextResponse.json({ jobs: rows });
}

// ---------------------------------------------------------------------------
// POST — kick off one new image generation. Body:
//   {
//     siteId, productId,
//     angle: 'lifestyle' | 'studio' | 'inuse' | 'custom',
//     customPrompt?: string,        // required when angle === 'custom'
//     replaceJobId?: string,        // when set, soft-hides that job
//                                   // and starts a fresh one in its place
//     imageQualityId?: ImageQualityId
//   }
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    siteId?: unknown;
    productId?: unknown;
    angle?: unknown;
    customPrompt?: unknown;
    replaceJobId?: unknown;
    imageQualityId?: unknown;
  };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const siteId = typeof body.siteId === 'string' ? body.siteId : '';
  const productId = typeof body.productId === 'string' ? body.productId : '';
  const angleRaw = typeof body.angle === 'string' ? body.angle : '';
  const customPromptRaw = typeof body.customPrompt === 'string' ? body.customPrompt : '';
  const replaceJobId = typeof body.replaceJobId === 'string' ? body.replaceJobId : null;

  const isCustom = angleRaw === 'custom';
  const isPreset = (IMAGE_ANGLES as readonly string[]).includes(angleRaw);
  if (!siteId || !productId || (!isCustom && !isPreset)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  // Cap free-text prompts at a sane length — kie can take more, but we
  // don't want a 50KB blob arriving from the browser.
  const customPrompt = customPromptRaw.slice(0, 800).trim();
  if (isCustom && !customPrompt) {
    return NextResponse.json({ error: 'prompt_required' }, { status: 400 });
  }

  const ctx = await loadOwnedContext(session.user.id, siteId, productId);
  if (!ctx) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }
  if (!ctx.sourceImage) {
    return NextResponse.json({ error: 'no_source_image' }, { status: 400 });
  }

  // Verify the replace target belongs to this product before we hide it,
  // so a forged jobId can't make us soft-delete somebody else's job.
  if (replaceJobId) {
    const target = await db.query.jobs.findFirst({
      where: and(
        eq(jobs.id, replaceJobId),
        eq(jobs.projectId, ctx.projectId),
        eq(jobs.kind, 'kie_image_edit')
      )
    });
    if (!target) {
      return NextResponse.json({ error: 'replace_target_not_found' }, { status: 404 });
    }
    const input = target.inputPayload as { productSourceId?: string } | null;
    if (input?.productSourceId !== ctx.productSourceId) {
      return NextResponse.json({ error: 'replace_target_mismatch' }, { status: 400 });
    }
  }

  // Visible-job cap. The cap is per-product (so a user with many products
  // can still generate plenty in aggregate). Replacing an existing job
  // doesn't grow the count, so we exempt that path.
  const visible = await listProductImageJobs(ctx.projectId, ctx.productSourceId);
  if (!replaceJobId && visible.length >= MAX_IMAGES_PER_PRODUCT) {
    return NextResponse.json(
      { error: 'image_cap_reached', max: MAX_IMAGES_PER_PRODUCT },
      { status: 409 }
    );
  }

  const imageQualityId = imageQualityFromBody(
    body.imageQualityId,
    session.user.preferredImageQuality
  );
  const cost = costForImage(imageQualityId);
  if ((session.user.creditsBalance ?? 0) < cost) {
    return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
  }

  const merchantInstructions = combineInstructions(
    ctx.projectInstructions,
    ctx.productInstructions
  );
  const prompt = buildImagePrompt(
    isCustom ? 'custom' : (angleRaw as 'lifestyle' | 'studio' | 'inuse'),
    customPrompt,
    merchantInstructions
  );

  // Hide-then-start: hide the slot's old job *first* so the polling client
  // sees the new pending row in the same place the old image used to sit.
  // If startImageOptim throws, the hide is durable — a small downside but
  // matches the user's mental model ("regenerate" implies the old one is
  // gone) and the new POST attempt simply starts another fresh job.
  if (replaceJobId) {
    await db.update(jobs).set({ hiddenAt: new Date() }).where(eq(jobs.id, replaceJobId));
  }

  try {
    const result = await startImageOptim({
      userId: session.user.id,
      projectId: ctx.projectId,
      productSourceId: ctx.productSourceId,
      sourceImageUrl: ctx.sourceImage,
      userPrompt: prompt,
      appUrl: process.env.APP_URL,
      imageQualityId
    });
    return NextResponse.json({ ok: true, jobId: result.jobId });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
    }
    console.error('[POST /api/products/image-jobs]', e);
    return NextResponse.json(
      {
        error: 'generation_failed',
        message: sanitizeUserFacingError((e as Error).message)
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — soft-hide one image job (the row stays for credit/audit history).
// Query: ?siteId=&productId=&jobId=
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const siteId = url.searchParams.get('siteId') ?? '';
  const productId = url.searchParams.get('productId') ?? '';
  const jobId = url.searchParams.get('jobId') ?? '';
  if (!siteId || !productId || !jobId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const ctx = await loadOwnedContext(session.user.id, siteId, productId);
  if (!ctx) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }

  const target = await db.query.jobs.findFirst({
    where: and(
      eq(jobs.id, jobId),
      eq(jobs.projectId, ctx.projectId),
      eq(jobs.kind, 'kie_image_edit')
    )
  });
  if (!target) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const input = target.inputPayload as { productSourceId?: string } | null;
  if (input?.productSourceId !== ctx.productSourceId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Cancel-and-refund path: when the merchant dismisses a tile that's
  // still pending/running, persistKieJobFailure flips the job to
  // `failed`, writes the error column, and idempotently refunds the
  // credit hold. We do this BEFORE hiding so a transient persist
  // failure doesn't strand the credits while the row disappears
  // visually. Already-terminal jobs (completed/failed/timed_out)
  // skip the refund branch — for completed jobs the merchant chose
  // to throw away a paid result, that's their call.
  if (target.status === 'pending' || target.status === 'running') {
    try {
      await persistKieJobFailure(jobId, target.kind, 'Cancelled by merchant', 'cancelled_by_user');
    } catch (e) {
      console.error('[DELETE /api/products/image-jobs] refund failed', e);
      return NextResponse.json({ error: 'cancel_failed' }, { status: 500 });
    }
  }

  await db.update(jobs).set({ hiddenAt: new Date() }).where(eq(jobs.id, jobId));
  return NextResponse.json({ ok: true });
}
