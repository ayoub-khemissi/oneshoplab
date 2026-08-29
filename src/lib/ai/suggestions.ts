import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction } from '@/lib/credits';
import { db } from '@/lib/db';
import { jobs, type ProductField } from '@/lib/db/schema';
import { languageNameForPrompt } from '@/lib/i18n/languages';
import { chatCompletion } from './chat-provider';
import { SYSTEM_CHAT_MODELS } from './models';
import { buildSuggestionPrompt, type ProductContext } from './prompts';

export interface PromptSuggestion {
  tone: string;
  prompt: string;
}

export interface SuggestionsResult {
  suggestions: PromptSuggestion[];
  fromCache: boolean;
  jobId: string;
}

/**
 * Get cached prompt suggestions for (project, productSourceId, field) or
 * generate fresh via Claude Haiku. Caching is keyed by inputPayload in the
 * jobs table — subsequent panel opens skip the kie call (and the credit
 * debit) entirely.
 */
export async function getOrGenerateSuggestions(opts: {
  userId: string;
  projectId: string;
  productSourceId: string;
  field: ProductField;
  product: ProductContext;
  /** Effective ISO 639-1 language code resolved by getEffectiveLanguage(). */
  languageCode: string;
}): Promise<SuggestionsResult> {
  const cached = await findCachedJob(opts.projectId, opts.productSourceId, opts.field);
  if (cached) {
    return { suggestions: cached.suggestions, fromCache: true, jobId: cached.jobId };
  }

  const userPrompt = buildSuggestionPrompt(
    opts.field,
    opts.product,
    languageNameForPrompt(opts.languageCode)
  );

  const response = await chatCompletion({
    model: SYSTEM_CHAT_MODELS.fast,
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: 1024
  });

  const text = response.text;
  const suggestions = parseSuggestions(text);

  const jobId = randomUUID();
  const now = new Date();
  await db.insert(jobs).values({
    id: jobId,
    projectId: opts.projectId,
    kind: 'kie_prompt_suggest',
    status: 'completed',
    inputPayload: { productSourceId: opts.productSourceId, field: opts.field },
    result: { suggestions },
    creditsCost: response.creditsConsumed,
    startedAt: now,
    finishedAt: now
  });

  if (response.creditsConsumed > 0) {
    await applyCreditTransaction({
      userId: opts.userId,
      delta: -response.creditsConsumed,
      reason: 'kie_prompt_suggest',
      jobId,
      idempotencyKey: `job-${jobId}`
    });
  }

  return { suggestions, fromCache: false, jobId };
}

export async function findCachedSuggestions(
  projectId: string,
  productSourceId: string,
  field: ProductField
): Promise<{ suggestions: PromptSuggestion[]; jobId: string } | null> {
  return findCachedJob(projectId, productSourceId, field);
}

async function findCachedJob(
  projectId: string,
  productSourceId: string,
  field: ProductField
): Promise<{ suggestions: PromptSuggestion[]; jobId: string } | null> {
  const candidates = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, 'kie_prompt_suggest'),
      eq(jobs.status, 'completed')
    ),
    orderBy: [desc(jobs.createdAt)],
    limit: 50
  });
  for (const j of candidates) {
    const input = j.inputPayload as { productSourceId?: string; field?: string } | null;
    if (input?.productSourceId === productSourceId && input.field === field) {
      const result = j.result as { suggestions?: PromptSuggestion[] } | null;
      if (result?.suggestions && Array.isArray(result.suggestions)) {
        return { suggestions: result.suggestions, jobId: j.id };
      }
    }
  }
  return null;
}

/**
 * Parse Claude's response which we asked to be a strict JSON array.
 * Falls back to extracting the first array-shaped block if the model
 * accidentally wrapped it in prose.
 */
function parseSuggestions(text: string): PromptSuggestion[] {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return validateSuggestions(parsed);
  } catch {
    /* fall through to bracket extraction */
  }
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return validateSuggestions(parsed);
    } catch {
      /* give up */
    }
  }
  return [];
}

function validateSuggestions(arr: unknown[]): PromptSuggestion[] {
  return arr
    .filter(
      (s): s is PromptSuggestion =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as { tone?: unknown }).tone === 'string' &&
        typeof (s as { prompt?: unknown }).prompt === 'string'
    )
    .slice(0, 8);
}
