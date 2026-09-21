import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { MAX_IMAGES_PER_PRODUCT } from '@/features/generate-product-images';
import {
  buildImagePrompt,
  IMAGE_ANGLES,
  startImageOptim,
  startRemoveBackground,
  type ImageAngle
} from '@/entities/generation-job';
import {
  costForImage,
  costForRemoveBackground,
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODEL_REGISTRY,
  resolveImageFormatId,
  type ImageQualityId
} from '@/entities/ai-model';
import { listProductImageJobs, persistKieJobFailure } from '@/entities/generation-job';
import { auth } from '@/entities/user';
import { InsufficientCreditsError } from '@/entities/credit';
import { db } from '@/shared/db';
import { jobs, products, projects } from '@/shared/db/schema';
import { sanitizeUserFacingError } from '@/shared/lib';

interface ProductImage {
  src: string;
  alt?: string | null;
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
  /** Every store image of the product — the pool a cut-out may start from. */
  images: ProductImage[];
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
  const persisted = (productRow.images ?? []) as ProductImage[];
  if (!sourceImage) {
    sourceImage = persisted[0]?.src ?? null;
  }

  return {
    userId,
    projectId: project.id,
    productSourceId: sourceId,
    sourceImage,
    images: persisted,
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
//     angle: ImageAngle | 'custom',   // any IMAGE_ANGLES preset
//     customPrompt?: string,        // required when angle === 'custom'
//     replaceJobId?: string,        // when set, soft-hides that job
//                                   // and starts a fresh one in its place
//     imageQualityId?: ImageQualityId,
//     imageFormatId?: ImageFormatId   // per-image ratio; omitted → account pref
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
    imageFormatId?: unknown;
    op?: unknown;
    sourceJobId?: unknown;
    sourceImageUrl?: unknown;
    thenRemoveBg?: unknown;
  };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const siteId = typeof body.siteId === 'string' ? body.siteId : '';
  const productId = typeof body.productId === 'string' ? body.productId : '';
  if (body.op === 'remove_bg') {
    if (!siteId || !productId) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    return removeBackground(session.user.id, session.user.creditsBalance ?? 0, siteId, productId, {
      sourceJobId: typeof body.sourceJobId === 'string' ? body.sourceJobId : null,
      sourceImageUrl: typeof body.sourceImageUrl === 'string' ? body.sourceImageUrl : null
    });
  }
  const thenRemoveBg = body.thenRemoveBg === true;
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
  // The modal offers a per-image ratio; without one the account preference
  // applies, and without that 'auto' (the source photo's own ratio).
  const imageFormatId = resolveImageFormatId(
    typeof body.imageFormatId === 'string' ? body.imageFormatId : session.user.preferredImageFormat
  );
  // The chained cut-out is billed when it starts, but a merchant who ticked
  // it is quoted the sum — refuse up front rather than deliver half of it.
  const cost = costForImage(imageQualityId) + (thenRemoveBg ? costForRemoveBackground() : 0);
  if ((session.user.creditsBalance ?? 0) < cost) {
    return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
  }

  const merchantInstructions = combineInstructions(
    ctx.projectInstructions,
    ctx.productInstructions
  );
  const prompt = buildImagePrompt(
    isCustom ? 'custom' : (angleRaw as ImageAngle),
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
      imageQualityId,
      imageFormatId,
      thenRemoveBg
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

// ---------------------------------------------------------------------------
// POST with op: 'remove_bg' — cut the background out of one picture of the
// product and add the transparent PNG to the grid. Body:
//   { siteId, productId, op: 'remove_bg',
//     sourceJobId?: string,       // one of the product's completed generations
//     sourceImageUrl?: string }   // or one of its own store images
// Exactly one of the two sources must be given.
// ---------------------------------------------------------------------------

async function removeBackground(
  userId: string,
  creditsBalance: number,
  siteId: string,
  productId: string,
  source: { sourceJobId: string | null; sourceImageUrl: string | null }
): Promise<NextResponse> {
  if (Boolean(source.sourceJobId) === Boolean(source.sourceImageUrl)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const ctx = await loadOwnedContext(userId, siteId, productId);
  if (!ctx) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }

  let sourceImageUrl: string;
  let sourceAlt: string | null = null;
  if (source.sourceJobId) {
    const src = await db.query.jobs.findFirst({
      where: and(
        eq(jobs.id, source.sourceJobId),
        eq(jobs.projectId, ctx.projectId),
        eq(jobs.kind, 'kie_image_edit'),
        eq(jobs.status, 'completed')
      )
    });
    const input = src?.inputPayload as { productSourceId?: string; op?: string } | null;
    const result = src?.result as { persistedUrls?: string[]; alts?: string[] } | null;
    const url = result?.persistedUrls?.[0];
    if (!src || input?.productSourceId !== ctx.productSourceId || !url) {
      return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
    }
    // Cutting out a cut-out is a no-op that would still cost credits.
    if (input?.op === 'remove_bg') {
      return NextResponse.json({ error: 'already_transparent' }, { status: 400 });
    }
    sourceImageUrl = url;
    sourceAlt = result?.alts?.[0] ?? null;
  } else {
    // Only a picture that is really this product's: the URL is forwarded to a
    // third party, so it must come from the store, not from the request.
    const own = ctx.images.find((img) => img.src === source.sourceImageUrl);
    const first = ctx.sourceImage === source.sourceImageUrl;
    if (!own && !first) {
      return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
    }
    if (!/^https:\/\//i.test(source.sourceImageUrl!)) {
      return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
    }
    sourceImageUrl = source.sourceImageUrl!;
    sourceAlt = own?.alt ?? null;
  }

  const visible = await listProductImageJobs(ctx.projectId, ctx.productSourceId);
  if (visible.length >= MAX_IMAGES_PER_PRODUCT) {
    return NextResponse.json(
      { error: 'image_cap_reached', max: MAX_IMAGES_PER_PRODUCT },
      { status: 409 }
    );
  }
  // One cut-out per source: the grid would show two identical PNGs.
  const duplicate = visible.some(
    (j) =>
      j.derived === 'remove_bg' &&
      (source.sourceJobId
        ? j.sourceJobId === source.sourceJobId
        : j.sourceImageUrl === sourceImageUrl)
  );
  if (duplicate) {
    return NextResponse.json({ error: 'already_transparent' }, { status: 409 });
  }

  const cost = costForRemoveBackground();
  if (creditsBalance < cost) {
    return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
  }

  try {
    const result = await startRemoveBackground({
      userId,
      projectId: ctx.projectId,
      productSourceId: ctx.productSourceId,
      sourceImageUrl,
      sourceJobId: source.sourceJobId,
      sourceAlt,
      appUrl: process.env.APP_URL
    });
    return NextResponse.json({ ok: true, jobId: result.jobId });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
    }
    console.error('[POST /api/products/image-jobs remove_bg]', e);
    return NextResponse.json(
      { error: 'generation_failed', message: sanitizeUserFacingError((e as Error).message) },
      { status: 500 }
    );
  }
}

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
