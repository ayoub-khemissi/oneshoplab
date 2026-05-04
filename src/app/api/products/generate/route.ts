import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import {
  costForImage,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_QUALITY,
  estimateChatCredits,
  runChatOptim,
  startImageOptim,
  type ChatModelId,
  type ChatOptimField,
  type ImageQualityId,
  type ProductContext
} from '@/lib/ai';
import { auth } from '@/lib/auth';
import { InsufficientCreditsError } from '@/lib/credits';
import { db } from '@/lib/db';
import { audits, products, projects } from '@/lib/db/schema';

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
    'Rewrite this title to be SEO-optimised, keyword-front-loaded and more compelling. Match the source language. Stay factually consistent with the product.',
  description:
    'Rewrite this description as benefit-led, scannable HTML (use <p>, <ul>, <li>, <strong>). 180-350 words. Match the source language. Stay factually consistent with the product.',
  tags:
    'Suggest 5-10 customer-facing discovery tags for this product. Match the source language.'
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

async function loadSnapshot(
  userId: string,
  siteId: string,
  productId: string
): Promise<{ projectId: string; product: ProductSnapshot } | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.id, siteId))
  });
  if (!project) return null;

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, project.id)),
    columns: { sourceId: true, handle: true }
  });
  if (!productRow) return null;

  const audit = await db.query.audits.findFirst({
    where: or(
      eq(audits.projectId, project.id),
      and(isNull(audits.projectId), eq(audits.domain, project.domain ?? ''))
    ),
    orderBy: [desc(audits.createdAt)]
  });
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
  return product ? { projectId: project.id, product } : null;
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

  let body: { siteId?: unknown; productId?: unknown; field?: unknown; customInstructions?: unknown };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const siteId = typeof body.siteId === 'string' ? body.siteId : '';
  const productId = typeof body.productId === 'string' ? body.productId : '';
  const fieldRaw = typeof body.field === 'string' ? body.field : '';
  const customInstructions =
    typeof body.customInstructions === 'string' ? body.customInstructions : '';

  if (!siteId || !productId || !VALID_FIELDS.includes(fieldRaw as GenField)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const field = fieldRaw as GenField;

  const loaded = await loadSnapshot(session.user.id, siteId, productId);
  if (!loaded) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }
  const { product, projectId } = loaded;
  const sourceId = product.sourceId ?? product.handle ?? '';
  const sourceImage = product.images[0]?.src;
  const context = toProductContext(product);

  const fieldsToRun: Array<'title' | 'description' | 'tags' | 'images'> =
    field === 'all' ? ['title', 'description', 'tags', 'images'] : [field];

  const chatModelId: ChatModelId =
    (session.user.preferredChatModel as ChatModelId | undefined) ?? DEFAULT_CHAT_MODEL;
  const imageQualityId: ImageQualityId =
    (session.user.preferredImageQuality as ImageQualityId | undefined) ?? DEFAULT_IMAGE_QUALITY;

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
              userPrompt: effectiveImagePrompt(angle, customInstructions),
              appUrl: process.env.APP_URL,
              imageQualityId
            })
          )
        );
      } else {
        await runChatOptim({
          userId: session.user!.id,
          projectId,
          productSourceId: sourceId,
          field: f,
          userPrompt: effectiveChatPrompt(f, customInstructions),
          product: context,
          chatModelId
        });
      }
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
      }
      console.error('[POST /api/products/generate]', f, e);
      // 5xx is the retry-eligible status code in the client hook. The
      // message is shown verbatim to the user once retries are exhausted.
      return NextResponse.json(
        { error: 'generation_failed', message: (e as Error).message },
        { status: 500 }
      );
    }
  }

  revalidatePath(`/dashboard/sites/${siteId}/products/${productId}`);
  return NextResponse.json({ ok: true });
}
