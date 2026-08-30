import { and, eq, inArray, sql } from 'drizzle-orm';
import { getEffectiveLanguage } from '@/entities/audit';
import { db } from '@/shared/db';
import { audits, jobs } from '@/shared/db/schema';
import { transitionJob } from '@/entities/generation-job';
import { languageNameForPrompt } from '@/shared/i18n';
import { chatCompletion } from '@/entities/ai-provider';
import { buildKieCallbackUrl, getKieClient } from '@/entities/ai-provider';
import { SYSTEM_CHAT_MODELS } from '@/entities/ai-model';

const IMAGE_MODEL = 'gpt-image-2-image-to-image';

export type RetryResult =
  { ok: true; status: 'completed' | 'running' } | { ok: false; reason: string; message?: string };

type JobRow = typeof jobs.$inferSelect;

interface SummaryShape {
  latestProducts?: Array<{
    sourceId: string | null;
    title: string;
    descriptionHtml: string;
    images: Array<{ src: string; alt: string | null }>;
    signals?: {
      tags?: string[];
      vendor?: string | null;
      productType?: string | null;
      priceMin?: number | null;
      priceMax?: number | null;
    };
  }>;
}

interface DynamicAuditTextResult {
  newTitle: string;
  newDescription: string;
  newTags: string[];
  instagramPost: string;
  rationale: string;
}

/**
 * Retry a failed/timed-out job in place. Updates the original job row so we
 * don't accumulate orphans — `attempts` is incremented for traceability.
 *
 * Pass `{ force: true }` to also re-fire jobs that were already `completed`
 * (used by the per-product "Regenerate all" button).
 *
 * Supported kinds:
 *   - kie_image_edit   → re-fire createTask with the original prompt + source.
 *   - kie_dynamic_audit → re-fire the Claude chat by rebuilding context from
 *     the linked audit's latest-products snapshot.
 */
export async function retryJob(
  jobId: string,
  options: { force?: boolean } = {}
): Promise<RetryResult> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return { ok: false, reason: 'not_found' };

  if (!options.force && job.status !== 'failed' && job.status !== 'timed_out') {
    return { ok: false, reason: 'not_retriable', message: `Already ${job.status}` };
  }
  // Don't fire on actively-running jobs even with force — would create duplicate kie tasks.
  if (job.status === 'running' || job.status === 'pending') {
    return { ok: false, reason: 'in_flight', message: `Currently ${job.status}` };
  }

  if (job.kind === 'kie_image_edit') return retryImageEditJob(job, options);
  if (job.kind === 'kie_dynamic_audit') return retryDynamicAuditJob(job, options);

  return { ok: false, reason: 'unsupported_kind', message: job.kind };
}

/**
 * Force-regenerate every AI job for a single product within an audit
 * (1 dynamic-audit chat + 3 image-edit jobs). Skips jobs that are already
 * in flight to avoid duplicate kie tasks.
 */
export async function regenerateProductJobs(
  auditId: string,
  productSourceId: string
): Promise<{ regenerated: number; skipped: number }> {
  const candidates = await db.query.jobs.findMany({
    where: and(
      eq(jobs.auditId, auditId),
      inArray(jobs.kind, ['kie_dynamic_audit', 'kie_image_edit'])
    )
  });

  const productJobs = candidates.filter((j) => {
    const psId = (j.inputPayload as { productSourceId?: string | null } | null)?.productSourceId;
    return psId === productSourceId;
  });

  let regenerated = 0;
  let skipped = 0;
  for (const j of productJobs) {
    const r = await retryJob(j.id, { force: true });
    if (r.ok) regenerated++;
    else skipped++;
  }
  return { regenerated, skipped };
}

async function retryImageEditJob(job: JobRow, options: { force?: boolean }): Promise<RetryResult> {
  const input = (job.inputPayload ?? null) as {
    sourceImageUrl?: string;
    userPrompt?: string;
  } | null;
  if (!input?.sourceImageUrl || !input.userPrompt) {
    return { ok: false, reason: 'missing_input' };
  }

  await transitionJob(
    db,
    job.id,
    'pending',
    {
      error: null,
      kieTaskId: null,
      finishedAt: null,
      startedAt: new Date(),
      // Atomic increment; the patch type is the insert shape, hence the cast.
      attempts: sql`${jobs.attempts} + 1` as unknown as number
    },
    { force: options.force }
  );

  try {
    const kie = getKieClient();
    const callBackUrl = buildKieCallbackUrl(process.env.APP_URL);
    const { taskId } = await kie.createTask({
      model: IMAGE_MODEL,
      input: {
        prompt: input.userPrompt,
        input_urls: [input.sourceImageUrl],
        aspect_ratio: 'auto',
        resolution: '1K'
      },
      ...(callBackUrl ? { callBackUrl } : {})
    });
    await transitionJob(db, job.id, 'running', { kieTaskId: taskId });
    return { ok: true, status: 'running' };
  } catch (e) {
    const message = (e as Error).message;
    await transitionJob(db, job.id, 'failed', { error: message });
    return { ok: false, reason: 'kie_failed', message };
  }
}

async function retryDynamicAuditJob(
  job: JobRow,
  options: { force?: boolean }
): Promise<RetryResult> {
  if (!job.auditId) return { ok: false, reason: 'no_audit_link' };

  const audit = await db.query.audits.findFirst({ where: eq(audits.id, job.auditId) });
  if (!audit?.summary) return { ok: false, reason: 'no_audit_summary' };

  const input = (job.inputPayload ?? null) as {
    productSourceId?: string | null;
    language?: string | null;
    platform?: string;
  } | null;
  if (!input?.productSourceId) return { ok: false, reason: 'missing_input' };

  const summary = audit.summary as SummaryShape;
  const product = summary.latestProducts?.find((p) => p.sourceId === input.productSourceId);
  if (!product) return { ok: false, reason: 'product_not_in_summary' };

  await transitionJob(
    db,
    job.id,
    'pending',
    {
      error: null,
      result: null,
      finishedAt: null,
      startedAt: new Date(),
      // Atomic increment; the patch type is the insert shape, hence the cast.
      attempts: sql`${jobs.attempts} + 1` as unknown as number
    },
    { force: options.force }
  );

  // Re-resolve language from the project override (or audit detection) at
  // retry time, not from the stored payload. An override set after the
  // first run is "a future generation" per the product spec.
  const langCode = await getEffectiveLanguage(job.projectId);
  const langName = languageNameForPrompt(langCode);
  const platform = input.platform ?? audit.platform;

  const description = product.descriptionHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
  const tags = product.signals?.tags?.slice(0, 10).join(', ') || 'none';
  const priceMin = product.signals?.priceMin;
  const priceMax = product.signals?.priceMax;
  const priceLine =
    priceMin != null ? `${priceMin}${priceMin === priceMax ? '' : `-${priceMax}`}` : 'unknown';

  const system = `You are an expert e-commerce SEO copywriter and Instagram strategist for ${platform} merchants. You output strictly valid JSON — no preamble, no markdown fences. Every text field must be written in ${langName}.`;
  const user = `Generate SEO-optimised, conversion-focused content for this product.

Product:
- Title: ${product.title}
- Vendor: ${product.signals?.vendor ?? 'unknown'}
- Type: ${product.signals?.productType ?? 'unknown'}
- Tags: ${tags}
- Price: ${priceLine}
- Current description: ${description || '(empty)'}

Output JSON with these EXACT keys, all text in ${langName}:
{
  "newTitle": "<SEO-optimised title, 50-65 chars>",
  "newDescription": "<HTML description with <p>, <ul>/<li>, <strong>>",
  "newTags": ["array", "of", "5-10", "tags"],
  "instagramPost": "<2-3 paragraphs + 6-10 hashtags>",
  "rationale": "<one short sentence>"
}

Output the JSON object only, no other text.`;

  try {
    const response = await chatCompletion({
      model: SYSTEM_CHAT_MODELS.quality,
      system,
      messages: [{ role: 'user', content: user }],
      max_tokens: 2048
    });
    const text = response.text;
    const parsed = parseStructuredJson(text);

    await transitionJob(db, job.id, parsed ? 'completed' : 'failed', {
      result: parsed ? { ...parsed, productSourceId: input.productSourceId } : null,
      error: parsed ? null : 'Could not parse Claude response as expected JSON.',
      creditsCost: response.creditsConsumed
    });

    return parsed ? { ok: true, status: 'completed' } : { ok: false, reason: 'parse_failed' };
  } catch (e) {
    const message = (e as Error).message;
    await transitionJob(db, job.id, 'failed', { error: message });
    return { ok: false, reason: 'kie_failed', message };
  }
}

function parseStructuredJson(text: string): DynamicAuditTextResult | null {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const newTitle = typeof obj.newTitle === 'string' ? obj.newTitle : null;
  const newDescription = typeof obj.newDescription === 'string' ? obj.newDescription : null;
  const newTags = Array.isArray(obj.newTags)
    ? obj.newTags.filter((t): t is string => typeof t === 'string')
    : null;
  const instagramPost = typeof obj.instagramPost === 'string' ? obj.instagramPost : null;
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';
  if (!newTitle || !newDescription || !newTags || !instagramPost) return null;
  return { newTitle, newDescription, newTags, instagramPost, rationale };
}
