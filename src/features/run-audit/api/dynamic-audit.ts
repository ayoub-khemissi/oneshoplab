import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/shared/db';
import { jobs } from '@/shared/db/schema';
import { transitionJob } from '@/entities/generation-job';
import { languageNameForPrompt } from '@/shared/i18n';
import {
  buildKieCallbackUrl,
  getKieClient,
  type ChatContentBlock,
  type ChatImageContent,
  type ChatTextContent
} from '@/entities/ai-provider';
import { chatCompletion } from '@/entities/ai-provider';
import { SYSTEM_CHAT_MODELS } from '@/entities/ai-model';
import { retryJob } from './retry-job';

/** How many product images we send to Claude as visual context for the rewrite. */
const MAX_VISION_IMAGES = 3;

const IMAGE_MODEL = 'gpt-image-2-image-to-image';
/** Budget hint stored on the job row — not debited (public audits are on us). */
const IMAGE_COST_BUDGET = 20;

export type ImageAngle = 'lifestyle' | 'studio' | 'inuse';

const IMAGE_ANGLE_PROMPTS: Record<ImageAngle, string> = {
  lifestyle:
    'A lifestyle photo of this product in a natural outdoor setting, soft golden-hour lighting, slight shallow depth of field. The product remains identical to the source — only the surrounding scene changes. Photorealistic, high quality.',
  studio:
    'A clean studio shot of this product on a minimalist warm-neutral background, professional product photography lighting, soft shadow underneath. The product is identical to the source.',
  inuse:
    'A candid lifestyle scene of someone naturally using or wearing this product in an everyday context, authentic and human, warm tones. The product is identical to the source.'
};

export interface ProductSummaryContext {
  sourceId: string | null;
  title: string;
  descriptionHtml: string;
  tags: string[];
  vendor: string | null;
  productType: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  images: Array<{ src: string; alt: string | null }>;
}

export interface DynamicAuditOptions {
  auditId: string;
  product: ProductSummaryContext;
  platform: string;
  /** Detected language code (e.g. 'fr', 'en'). Falls back to English when null. */
  language: string | null;
  appUrl?: string | null;
}

export interface SocialPost {
  /** Short label like "Punchy", "Storytelling", "Lifestyle". */
  tone: string;
  /** The post body, ready to paste, with hashtags. */
  content: string;
}

export interface DynamicAuditTextResult {
  newTitle: string;
  newDescription: string;
  newTags: string[];
  /** 3 distinct social posts in different tones. */
  socialPosts: SocialPost[];
  /**
   * Legacy: kept for read-time backwards-compat with results saved before the
   * `socialPosts` array landed. Always equals socialPosts[0]?.content on new
   * generations.
   */
  instagramPost: string;
  rationale: string;
}

export type RegenSection = 'title' | 'description' | 'tags' | 'social' | 'images';

const SECTION_OUTPUT_SPEC: Record<
  Exclude<RegenSection, 'images'>,
  { key: string; spec: string }
> = {
  title: {
    key: 'newTitle',
    spec: '<SEO-optimised title, 50-65 chars, keyword-front-loaded, factually consistent with all available evidence>'
  },
  description: {
    key: 'newDescription',
    spec: '<HTML description, 180-350 words. MUST be split into 2-4 short <p> paragraphs (no wall-of-text). MUST include one <ul> with 3-5 <li> bullet points highlighting key benefits or specs. Use <strong> on key value props. Format must paste cleanly into Shopify / WooCommerce / Wix rich editors.>'
  },
  tags: {
    key: 'newTags',
    spec: '["array", "of", "5-10", "customer-facing", "discovery", "tags"]'
  },
  social: {
    key: 'socialPosts',
    spec: '[{"tone":"Punchy","content":"…"},{"tone":"Storytelling","content":"…"},{"tone":"Lifestyle","content":"…"}] — exactly 3 distinct posts in different tones. Each: 2-3 short paragraphs, 1-2 emojis used sparingly, ends with 6-10 relevant hashtags. Tones must feel genuinely different.'
  }
};

// ============================================================================
// Prompt building
// ============================================================================

function buildEvidenceContext(opts: DynamicAuditOptions): {
  imageBlocks: ChatImageContent[];
  evidenceBlock: string;
  productBlock: string;
  langName: string;
  langCode: string;
} {
  const langCode = opts.language ?? 'en';
  const langName = languageNameForPrompt(langCode);
  const description = opts.product.descriptionHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
  const priceLine =
    opts.product.priceMin != null
      ? `${opts.product.priceMin}${opts.product.priceMin === opts.product.priceMax ? '' : `-${opts.product.priceMax}`} ${opts.product.currency ?? ''}`.trim()
      : 'unknown';

  const imageBlocks: ChatImageContent[] = opts.product.images
    .slice(0, MAX_VISION_IMAGES)
    .filter((img) => typeof img.src === 'string' && /^https?:\/\//i.test(img.src))
    .map((img) => ({
      type: 'image',
      source: { type: 'url', url: img.src }
    }));

  const hasImages = imageBlocks.length > 0;
  const hasDescription = description.length > 0;
  const hasTags = opts.product.tags.length > 0;

  const evidenceBlock = `Available evidence: ${[
    hasImages ? `${imageBlocks.length} image(s)` : 'no images',
    hasDescription ? 'description' : 'no description',
    hasTags ? 'tags' : 'no tags'
  ].join(', ')}.

Evidence rules:
- Treat images and merchant text as COMPLEMENTARY evidence — both inform your output.
- When they AGREE: confidently double-down on the shared signal.
- When they DISAGREE on visual attributes (gender/audience, colour, material, category, silhouette): TRUST THE IMAGES — the merchant title may be a mistake.
- For facts NOT visible (specs, dimensions, ingredients, certifications, sizing, technical claims): TRUST THE MERCHANT TEXT.
- Never invent details that are absent from BOTH sources.`;

  const productBlock = `Merchant text:
- Title: ${opts.product.title}
- Vendor: ${opts.product.vendor ?? 'unknown'}
- Type: ${opts.product.productType ?? 'unknown'}
- Tags: ${opts.product.tags.slice(0, 10).join(', ') || 'none'}
- Price: ${priceLine}
- Current description: ${description || '(empty)'}`;

  return { imageBlocks, evidenceBlock, productBlock, langName, langCode };
}

function buildDynamicAuditPrompt(opts: DynamicAuditOptions): {
  system: string;
  userContent: ChatContentBlock[];
} {
  const { imageBlocks, evidenceBlock, productBlock, langName } = buildEvidenceContext(opts);

  const textBlock: ChatTextContent = {
    type: 'text',
    text: `${evidenceBlock}

Generate SEO-optimised, conversion-focused content for this product.

${productBlock}

Output JSON with these EXACT keys, all text in ${langName}:
{
  "newTitle": "${SECTION_OUTPUT_SPEC.title.spec}",
  "newDescription": "${SECTION_OUTPUT_SPEC.description.spec}",
  "newTags": ${SECTION_OUTPUT_SPEC.tags.spec},
  "socialPosts": ${SECTION_OUTPUT_SPEC.social.spec},
  "rationale": "<one short sentence: the angle taken AND which evidence (image vs text) drove key decisions like gender/audience>"
}

Output the JSON object only, no other text.`
  };

  return {
    system: `You are an expert e-commerce SEO copywriter and social media strategist for ${opts.platform} merchants who carefully reads product images before writing. You output strictly valid JSON — no preamble, no markdown fences. Every text field must be written in ${langName}. NEVER assume gender or audience from the title alone — verify against the images first; if the title disagrees with what the images show, the images win.`,
    userContent: imageBlocks.length > 0 ? [...imageBlocks, textBlock] : [textBlock]
  };
}

function buildSectionPrompt(
  opts: DynamicAuditOptions,
  section: Exclude<RegenSection, 'images'>
): { system: string; userContent: ChatContentBlock[] } {
  const { imageBlocks, evidenceBlock, productBlock, langName } = buildEvidenceContext(opts);
  const spec = SECTION_OUTPUT_SPEC[section];

  const textBlock: ChatTextContent = {
    type: 'text',
    text: `${evidenceBlock}

Generate ONLY the "${spec.key}" field for this product, no other fields. The output must be a fresh, distinct take from any previous generation.

${productBlock}

Output JSON with EXACTLY this single key, in ${langName}:
{
  "${spec.key}": ${section === 'tags' || section === 'social' ? spec.spec : `"${spec.spec}"`}
}

Output the JSON object only, no other text.`
  };

  return {
    system: `You are an expert e-commerce SEO copywriter and social media strategist for ${opts.platform} merchants who carefully reads product images before writing. You output strictly valid JSON — no preamble, no markdown fences. Output is in ${langName}. NEVER assume gender or audience from the title alone — verify against the images first; if the title disagrees with what the images show, the images win.`,
    userContent: imageBlocks.length > 0 ? [...imageBlocks, textBlock] : [textBlock]
  };
}

// ============================================================================
// Full audit run (used on first audit completion)
// ============================================================================

/**
 * Run the AI part of the dynamic audit for a single product:
 *   1. One synchronous Claude Sonnet call → JSON with title/description/tags/
 *      3 socialPosts/rationale, all in the detected language.
 *   2. Three kie.ai image-to-image createTasks fired in parallel (lifestyle,
 *      studio, in-use). Image jobs complete asynchronously via the webhook
 *      handler or the worker watchdog.
 *
 * No credit debit — public audits are funded by us. Each generation is
 * persisted as a job row keyed by `auditId` so the report page can pick
 * it up via querying jobs of the audit.
 */
export async function runDynamicAuditForProduct(opts: DynamicAuditOptions): Promise<void> {
  await runDynamicAuditChat(opts);
  await fireImageGenerations(opts);
}

async function runDynamicAuditChat(opts: DynamicAuditOptions): Promise<void> {
  const { system, userContent } = buildDynamicAuditPrompt(opts);

  const jobId = randomUUID();
  const startedAt = new Date();

  let parsed: DynamicAuditTextResult | null = null;
  let creditsConsumed = 0;
  let error: string | null = null;

  try {
    const response = await chatCompletion({
      model: SYSTEM_CHAT_MODELS.quality,
      system,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 3072
    });
    creditsConsumed = response.creditsConsumed;
    const text = response.text;
    parsed = parseStructuredJson(text);
    if (!parsed) {
      error = 'Could not parse Claude response as expected JSON.';
    }
  } catch (e) {
    error = (e as Error).message;
  }

  await db.insert(jobs).values({
    id: jobId,
    auditId: opts.auditId,
    kind: 'kie_dynamic_audit',
    status: parsed ? 'completed' : 'failed',
    inputPayload: {
      productSourceId: opts.product.sourceId,
      language: opts.language,
      platform: opts.platform
    },
    result: parsed ? { ...parsed, productSourceId: opts.product.sourceId } : null,
    error,
    creditsCost: creditsConsumed,
    startedAt,
    finishedAt: new Date()
  });
}

async function fireImageGenerations(opts: DynamicAuditOptions): Promise<void> {
  const sourceImage = opts.product.images[0]?.src;
  if (!sourceImage) return;

  await Promise.allSettled(
    (Object.keys(IMAGE_ANGLE_PROMPTS) as ImageAngle[]).map((angle) =>
      startProductImageJob({
        auditId: opts.auditId,
        productSourceId: opts.product.sourceId,
        sourceImage,
        angle,
        appUrl: opts.appUrl ?? null
      })
    )
  );
}

interface StartImageJobOptions {
  auditId: string;
  productSourceId: string | null;
  sourceImage: string;
  angle: ImageAngle;
  appUrl: string | null;
}

async function startProductImageJob(opts: StartImageJobOptions): Promise<void> {
  const kie = getKieClient();
  const prompt = IMAGE_ANGLE_PROMPTS[opts.angle];
  const jobId = randomUUID();
  const startedAt = new Date();

  await db.insert(jobs).values({
    id: jobId,
    auditId: opts.auditId,
    kind: 'kie_image_edit',
    status: 'pending',
    inputPayload: {
      productSourceId: opts.productSourceId,
      angle: opts.angle,
      sourceImageUrl: opts.sourceImage,
      userPrompt: prompt
    },
    creditsCost: IMAGE_COST_BUDGET,
    startedAt
  });

  try {
    const callBackUrl = buildKieCallbackUrl(opts.appUrl);

    const { taskId } = await kie.createTask({
      model: IMAGE_MODEL,
      input: {
        prompt,
        input_urls: [opts.sourceImage],
        aspect_ratio: 'auto',
        resolution: '1K'
      },
      ...(callBackUrl ? { callBackUrl } : {})
    });

    await transitionJob(db, jobId, 'running', { kieTaskId: taskId });
  } catch (e) {
    const message = (e as Error).message;
    await transitionJob(db, jobId, 'failed', { error: message });
  }
}

// ============================================================================
// Per-section regeneration
// ============================================================================

/**
 * Regenerate ONE section for a product:
 *   - 'title' / 'description' / 'tags' / 'social': run a focused Claude chat
 *     asking only for that field; merge into the existing kie_dynamic_audit
 *     job's result so the other sections stay intact.
 *   - 'images': force-retry the existing kie_image_edit jobs for the product
 *     so each angle picks up a fresh kie task.
 *
 * Public audits are not debited; we still record the kie credits_consumed on
 * the job row for analytics.
 */
export async function regenerateProductSection(opts: {
  auditId: string;
  productSourceId: string | null;
  section: RegenSection;
  product: ProductSummaryContext;
  platform: string;
  language: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  if (opts.section === 'images') {
    return regenerateImageSection(opts.auditId, opts.productSourceId);
  }

  const existingJob = await findDynamicAuditJob(opts.auditId, opts.productSourceId);
  if (!existingJob) {
    return { ok: false, reason: 'no_base_job' };
  }

  const { system, userContent } = buildSectionPrompt(opts, opts.section);

  let creditsConsumed = 0;
  let partial: Partial<DynamicAuditTextResult> | null = null;
  let error: string | null = null;

  try {
    const response = await chatCompletion({
      model: SYSTEM_CHAT_MODELS.quality,
      system,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 1536
    });
    creditsConsumed = response.creditsConsumed;
    const text = response.text;
    partial = parseSectionResponse(text, opts.section);
    if (!partial) {
      error = `Could not parse ${opts.section} response.`;
    }
  } catch (e) {
    error = (e as Error).message;
  }

  if (!partial) {
    await db
      .update(jobs)
      .set({
        error,
        finishedAt: new Date(),
        creditsCost: (existingJob.creditsCost ?? 0) + creditsConsumed
      })
      .where(eq(jobs.id, existingJob.id));
    return { ok: false, reason: error ?? 'unknown' };
  }

  const existingResult = (existingJob.result ?? {}) as DynamicAuditTextResult & {
    productSourceId?: string | null;
  };
  const merged: DynamicAuditTextResult & { productSourceId?: string | null } = {
    ...existingResult,
    ...partial,
    // Keep instagramPost in sync with socialPosts[0].content for legacy readers.
    instagramPost:
      partial.socialPosts?.[0]?.content ??
      existingResult.socialPosts?.[0]?.content ??
      existingResult.instagramPost ??
      ''
  };

  const patch = {
    result: merged,
    error: null,
    finishedAt: new Date(),
    creditsCost: (existingJob.creditsCost ?? 0) + creditsConsumed
  };
  if (existingJob.status === 'completed') {
    // Section regen on an already-completed base job: the status doesn't
    // change, only the merged result — no transition to guard.
    await db.update(jobs).set(patch).where(eq(jobs.id, existingJob.id));
  } else {
    await transitionJob(db, existingJob.id, 'completed', patch);
  }

  return { ok: true };
}

async function regenerateImageSection(
  auditId: string,
  productSourceId: string | null
): Promise<{ ok: boolean; reason?: string }> {
  const all = await db.query.jobs.findMany({
    where: and(eq(jobs.auditId, auditId), eq(jobs.kind, 'kie_image_edit'))
  });
  const targets = all.filter(
    (j) =>
      (j.inputPayload as { productSourceId?: string | null } | null)?.productSourceId ===
      productSourceId
  );
  if (targets.length === 0) return { ok: false, reason: 'no_image_jobs' };

  let regenerated = 0;
  for (const j of targets) {
    const r = await retryJob(j.id, { force: true });
    if (r.ok) regenerated += 1;
  }
  return regenerated > 0 ? { ok: true } : { ok: false, reason: 'all_retries_failed' };
}

async function findDynamicAuditJob(
  auditId: string,
  productSourceId: string | null
): Promise<typeof jobs.$inferSelect | null> {
  const candidates = await db.query.jobs.findMany({
    where: and(eq(jobs.auditId, auditId), eq(jobs.kind, 'kie_dynamic_audit'))
  });
  const match = candidates.find(
    (j) =>
      (j.inputPayload as { productSourceId?: string | null } | null)?.productSourceId ===
      productSourceId
  );
  return match ?? null;
}

// ============================================================================
// JSON parsers
// ============================================================================

function jsonExtract(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function parseSocialPosts(value: unknown): SocialPost[] | null {
  if (!Array.isArray(value)) return null;
  const posts: SocialPost[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const tone =
      typeof (item as Record<string, unknown>).tone === 'string'
        ? (item as { tone: string }).tone
        : '';
    const content =
      typeof (item as Record<string, unknown>).content === 'string'
        ? (item as { content: string }).content
        : '';
    if (content.length === 0) continue;
    posts.push({ tone: tone || 'Default', content });
  }
  return posts.length > 0 ? posts : null;
}

function parseStructuredJson(text: string): DynamicAuditTextResult | null {
  const parsed = jsonExtract(text);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const newTitle = typeof obj.newTitle === 'string' ? obj.newTitle : null;
  const newDescription = typeof obj.newDescription === 'string' ? obj.newDescription : null;
  const newTags = Array.isArray(obj.newTags)
    ? obj.newTags.filter((t): t is string => typeof t === 'string')
    : null;
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';

  const socialPosts =
    parseSocialPosts(obj.socialPosts) ??
    (typeof obj.instagramPost === 'string' && obj.instagramPost.length > 0
      ? [{ tone: 'Default', content: obj.instagramPost }]
      : null);

  if (!newTitle || !newDescription || !newTags || !socialPosts) return null;

  return {
    newTitle,
    newDescription,
    newTags,
    socialPosts,
    instagramPost: socialPosts[0]?.content ?? '',
    rationale
  };
}

function parseSectionResponse(
  text: string,
  section: Exclude<RegenSection, 'images'>
): Partial<DynamicAuditTextResult> | null {
  const parsed = jsonExtract(text);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (section === 'title') {
    const v = typeof obj.newTitle === 'string' ? obj.newTitle : null;
    return v ? { newTitle: v } : null;
  }
  if (section === 'description') {
    const v = typeof obj.newDescription === 'string' ? obj.newDescription : null;
    return v ? { newDescription: v } : null;
  }
  if (section === 'tags') {
    const v = Array.isArray(obj.newTags)
      ? obj.newTags.filter((t): t is string => typeof t === 'string')
      : null;
    return v && v.length > 0 ? { newTags: v } : null;
  }
  if (section === 'social') {
    const v = parseSocialPosts(obj.socialPosts);
    return v ? { socialPosts: v } : null;
  }
  return null;
}
