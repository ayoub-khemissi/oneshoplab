import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction, getCreditBalance } from '@/entities/credit';
import { db } from '@/shared/db';
import { jobs, type ProductField } from '@/shared/db/schema';
import { languageNameForPrompt } from '@/shared/i18n';
import { chatCompletion } from '@/entities/ai-provider';
import {
  SYSTEM_CHAT_MODELS,
  estimateChatCredits,
  outputTokenCapFor,
  systemChatModel
} from '@/entities/ai-model';
import { buildSuggestionPrompt, type ProductContext } from '../lib/prompts';

export interface PromptSuggestion {
  tone: string;
  prompt: string;
}

export type SuggestionsResult =
  | { ok: true; suggestions: PromptSuggestion[]; fromCache: boolean; jobId: string }
  | { ok: false; reason: 'insufficient_credits' | 'generation_failed' };

/**
 * What one round of suggestions costs, decided by the catalog exactly like a
 * generation: the `suggest` cap × the system model's rates × the text markup.
 * Deterministic on purpose — the button shows this number before the click,
 * and this is the number debited.
 */
export function suggestionsCost(): number {
  return estimateChatCredits(systemChatModel('fast').id, 'suggest');
}

/**
 * Cached prompt suggestions for (project, productSourceId, field), or a fresh
 * round from the fast system model. The cache is keyed by the job row's
 * inputPayload, so asking again for the same product and field costs nothing.
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
    return { ok: true, suggestions: cached.suggestions, fromCache: true, jobId: cached.jobId };
  }

  const cost = suggestionsCost();
  if ((await getCreditBalance(opts.userId)) < cost) {
    return { ok: false, reason: 'insufficient_credits' };
  }

  const userPrompt = buildSuggestionPrompt(
    opts.field,
    opts.product,
    languageNameForPrompt(opts.languageCode)
  );

  const response = await chatCompletion({
    model: SYSTEM_CHAT_MODELS.fast,
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: outputTokenCapFor('suggest')
  });

  const suggestions = parseSuggestions(response.text);
  // Nothing usable came back: the merchant keeps their credits rather than
  // paying for an empty list.
  if (suggestions.length === 0) return { ok: false, reason: 'generation_failed' };

  const jobId = randomUUID();
  const now = new Date();
  await db.insert(jobs).values({
    id: jobId,
    projectId: opts.projectId,
    kind: 'kie_prompt_suggest',
    status: 'completed',
    inputPayload: { productSourceId: opts.productSourceId, field: opts.field },
    result: { suggestions },
    creditsCost: cost,
    startedAt: now,
    finishedAt: now
  });

  await applyCreditTransaction({
    userId: opts.userId,
    delta: -cost,
    reason: 'kie_prompt_suggest',
    jobId,
    idempotencyKey: `job-${jobId}`
  });

  return { ok: true, suggestions, fromCache: false, jobId };
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
