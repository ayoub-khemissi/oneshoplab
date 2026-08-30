import { resolveChatModelId } from '@/entities/ai-model';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import {
  CHAT_MODEL_REGISTRY,
  costForImage,
  DEFAULT_IMAGE_QUALITY,
  estimateChatCredits,
  IMAGE_MODEL_REGISTRY,
  MAX_CUSTOM_INSTRUCTIONS_CHARS,
  type ChatModelId,
  type ImageQualityId
} from '@/entities/ai-model';
import { runChatOptim, type ProductContext } from '@/features/generate-product-copy';
import { startImageOptim } from '@/features/generate-product-images';
import type { ChatOptimField } from '@/entities/generation-job';
import { getEffectiveLanguage } from '@/entities/audit';
import { auth } from '@/lib/auth';
import { sanitizeUserFacingError } from '@/lib/errors';
import { InsufficientCreditsError } from '@/lib/credits';
import { db } from '@/lib/db';
import { products, projects } from '@/lib/db/schema';

const IMAGE_ANGLES = ['lifestyle', 'studio', 'inuse'] as const;
type ImageAngle = (typeof IMAGE_ANGLES)[number];

const IMAGE_ANGLE_PROMPTS: Record<ImageAngle, string> = {
  lifestyle:
    'A lifestyle photo of this product in a natural outdoor setting, soft golden-hour lighting, slight shallow depth of field. The product remains identical to the source — only the surrounding scene changes. Photorealistic, high quality.',
  studio:
    'A clean studio shot of this product on a minimalist warm-neutral background, professional product photography lighting, soft shadow underneath. The product is identical to the source.',
  inuse:
    'A candid lifestyle scene of someone naturally using or wearing this product in an everyday context, authentic and human, warm tones. The product is identical to the source.'
};

const FIELD_DEFAULT_PROMPT: Record<ChatOptimField, string> = {
  title:
    'Rewrite this title to be SEO-optimised, keyword-front-loaded and more compelling. Stay factually consistent with the product.',
  description:
    'Rewrite this description as benefit-led, scannable HTML (use <p>, <ul>, <li>, <strong>). 180-350 words. Stay factually consistent with the product.',
  tags: 'Suggest 5-10 customer-facing discovery tags for this product.'
};

type GenField = 'title' | 'description' | 'tags' | 'images' | 'all';
const VALID_FIELDS: readonly GenField[] = ['title', 'description', 'tags', 'images', 'all'];

interface ProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

interface ProductSnapshot {
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
  worstProducts?: ProductSnapshot[];
  latestProducts?: ProductSnapshot[];
  bestProducts?: ProductSnapshot[];
  allProducts?: ProductSnapshot[];
}

function effectiveChatPrompt(field: ChatOptimField, custom: string): string {
  const trimmed = custom.trim();
  return trimmed
    ? `${FIELD_DEFAULT_PROMPT[field]}\n\nAdditional instructions from the merchant:\n${trimmed}`
    : FIELD_DEFAULT_PROMPT[field];
}

function effectiveImagePrompt(angle: ImageAngle, custom: string): string {
  const trimmed = custom.trim();
  return trimmed ? `${IMAGE_ANGLE_PROMPTS[angle]} ${trimmed}` : IMAGE_ANGLE_PROMPTS[angle];
}

function toProductContext(p: ProductSnapshot): ProductContext {
  const text = p.descriptionHtml
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

interface LoadedSnapshot {
  projectId: string;
  product: ProductSnapshot;
  /** Site-wide AI instructions configured on the project, if any. */
  projectInstructions: string | null;
  /** Effective language for AI generations (override → detected → 'en'). */
  languageCode: string;
}

async function loadSnapshot(
  userId: string,
  siteId: string,
  productId: string
): Promise<LoadedSnapshot | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.id, siteId))
  });
  if (!project) return null;

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, project.id)),
    columns: { sourceId: true, handle: true }
  });
  if (!productRow) return null;

  const { findLatestAuditForProject } = await import('@/entities/audit');
  const audit = await findLatestAuditForProject(project.id, project.domain);
  if (!audit?.summary) return null;

  const summary = audit.summary as SummaryShape;
  const all = [
    ...(summary.allProducts ?? []),
    ...(summary.worstProducts ?? []),
    ...(summary.latestProducts ?? []),
    ...(summary.bestProducts ?? [])
  ];
  const product = all.find((p) => {
    if (productRow.sourceId && p.sourceId === productRow.sourceId) return true;
    if (productRow.handle && p.handle === productRow.handle) return true;
    return false;
  });
  if (!product) return null;
  const languageCode = await getEffectiveLanguage(project.id);
  return {
    projectId: project.id,
    product,
    projectInstructions: project.customInstructions ?? null,
    languageCode
  };
}

/**
 * Combine the per-call instructions (what the merchant just typed) with the
 * site-wide instructions stored on the project. The site-wide block goes
 * first as it represents the general brand voice; the per-product block
 * follows as a more specific override. Empty / whitespace-only strings are
 * dropped so the prompt stays clean.
 */
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

/**
 * Per-product generation endpoint. Accepts a single field at a time (or
 * 'all' to fan out across the four core fields). Returns 200 on success
 * and a categorical 4xx for non-retryable client errors. Failures the
 * caller may want to retry (transient kie outage, 5xx) bubble up as 500
 * with the message in the body — the client retry hook is wired to retry
 * only on 5xx / network errors.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    siteId?: unknown;
    productId?: unknown;
    field?: unknown;
    customInstructions?: unknown;
    chatModelId?: unknown;
    imageQualityId?: unknown;
  };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const siteId = typeof body.siteId === 'string' ? body.siteId : '';
  const productId = typeof body.productId === 'string' ? body.productId : '';
  const fieldRaw = typeof body.field === 'string' ? body.field : '';
  const customInstructionsRaw =
    typeof body.customInstructions === 'string' ? body.customInstructions : '';
  // Truncate defensively — the front-end caps via maxLength but a hand-rolled
  // request could try to bypass it. Keeps the input-token cost bounded.
  const customInstructions = customInstructionsRaw.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS);
  const bodyChatModel = typeof body.chatModelId === 'string' ? body.chatModelId : null;
  const bodyImageQuality = typeof body.imageQualityId === 'string' ? body.imageQualityId : null;

  if (!siteId || !productId || !VALID_FIELDS.includes(fieldRaw as GenField)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const field = fieldRaw as GenField;

  const loaded = await loadSnapshot(session.user.id, siteId, productId);
  if (!loaded) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }
  const { product, projectId, projectInstructions, languageCode } = loaded;
  const sourceId = product.sourceId ?? product.handle ?? '';
  const sourceImage = product.images[0]?.src;
  const context = toProductContext(product);

  // Auto-save the per-product instructions on every generation so the
  // textarea pre-fills with the merchant's last guidance on next visit.
  // An empty string clears any previous value.
  const trimmedCustom = customInstructions.trim();
  await db
    .update(products)
    .set({ customInstructions: trimmedCustom.length > 0 ? trimmedCustom : null })
    .where(eq(products.id, productId));

  // Site-wide guidance (if any) prefixes the per-call instructions before
  // they're appended to the field's default prompt.
  const merchantInstructions = combineInstructions(projectInstructions, customInstructions);

  // For 'all', queue images FIRST: startImageOptim is async (creates the
  // jobs + posts to kie + returns in <1s), so the merchant's image grid
  // shows the 3 skeleton placeholders immediately while the synchronous
  // chat fields run for the next ~25-30s. Without this, the request
  // blocks on chat for the full duration before image jobs even exist
  // in the DB and the user sees nothing.
  const fieldsToRun: Array<'title' | 'description' | 'tags' | 'images'> =
    field === 'all' ? ['images', 'title', 'description', 'tags'] : [field];

  // Body overrides win over the persisted preference: the chips on the optim
  // page mutate the user's selection client-side and pass it through here, so
  // an in-flight click is honored even before the persist server action lands.
  const chatModelId: ChatModelId =
    bodyChatModel != null && bodyChatModel in CHAT_MODEL_REGISTRY
      ? (bodyChatModel as ChatModelId)
      : resolveChatModelId(session.user.preferredChatModel);
  const imageQualityId: ImageQualityId =
    (bodyImageQuality != null && bodyImageQuality in IMAGE_MODEL_REGISTRY
      ? (bodyImageQuality as ImageQualityId)
      : (session.user.preferredImageQuality as ImageQualityId | undefined)) ??
    DEFAULT_IMAGE_QUALITY;

  const totalCost = fieldsToRun.reduce((sum, f) => {
    if (f === 'images') return sum + costForImage(imageQualityId) * IMAGE_ANGLES.length;
    return sum + estimateChatCredits(chatModelId, f);
  }, 0);
  if ((session.user.creditsBalance ?? 0) < totalCost) {
    return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
  }

  // Honor an upstream client abort (user pressed cancel). If the request
  // already aborted before we got here, bail without doing work.
  if (req.signal.aborted) {
    return NextResponse.json({ error: 'aborted' }, { status: 499 });
  }

  // Chat jobs return their jobId so the client can mark the
  // corresponding notification as read once it shows the success
  // toast (image jobs are async — the bell badge ticks until the
  // merchant opens it).
  const chatJobIds: string[] = [];
  for (const f of fieldsToRun) {
    if (req.signal.aborted) {
      return NextResponse.json({ error: 'aborted' }, { status: 499 });
    }
    try {
      if (f === 'images') {
        if (!sourceImage) continue;
        await Promise.allSettled(
          IMAGE_ANGLES.map((angle) =>
            startImageOptim({
              userId: session.user!.id,
              projectId,
              productSourceId: sourceId,
              sourceImageUrl: sourceImage,
              userPrompt: effectiveImagePrompt(angle, merchantInstructions),
              appUrl: process.env.APP_URL,
              imageQualityId
            })
          )
        );
      } else {
        const r = await runChatOptim({
          userId: session.user!.id,
          projectId,
          productSourceId: sourceId,
          field: f,
          userPrompt: effectiveChatPrompt(f, merchantInstructions),
          product: context,
          chatModelId,
          languageCode
        });
        chatJobIds.push(r.jobId);
      }
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
      }
      console.error('[POST /api/products/generate]', f, e);
      // 5xx is the retry-eligible status code in the client hook.
      // Sanitize the message before crossing the wire — once retries
      // are exhausted, the toast shows what we return here, and the
      // upstream provider's name ("kie chat failed: …") must never
      // leak into a user-facing surface.
      return NextResponse.json(
        {
          error: 'generation_failed',
          message: sanitizeUserFacingError((e as Error).message)
        },
        { status: 500 }
      );
    }
  }

  revalidatePath(`/dashboard/sites/${siteId}/products/${productId}`);
  return NextResponse.json({ ok: true, chatJobIds });
}
