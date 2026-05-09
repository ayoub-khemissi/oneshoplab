import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction } from '@/lib/credits';
import { db } from '@/lib/db';
import { jobs, type JobKind } from '@/lib/db/schema';
import { languageNameForPrompt } from '@/lib/i18n/languages';
import { KieClient, getKieClient, type ChatMessage } from './kie';
import {
  estimateChatCredits,
  getChatModel,
  outputTokenCapFor,
  type ChatModelId
} from './models';
import {
  buildDescriptionRewritePrompt,
  buildTagSuggestionPrompt,
  buildTitleRewritePrompt,
  type ProductContext
} from './prompts';

export type ChatOptimField = 'title' | 'description' | 'tags';

export interface ChatOptimRequest {
  userId: string;
  projectId: string;
  productSourceId: string;
  field: ChatOptimField;
  /** The prompt the user picked from suggestions or typed themselves. */
  userPrompt: string;
  product: ProductContext;
  /** Caller-selected chat model. Falls back to the user's preference / default. */
  chatModelId?: ChatModelId;
  /** Effective ISO 639-1 language code resolved by getEffectiveLanguage(). */
  languageCode: string;
}

export interface ChatOptimResult {
  jobId: string;
  field: ChatOptimField;
  /** string for title/description (HTML for description), string[] for tags. */
  output: string | string[];
  creditsConsumed: number;
}

const KIND_BY_FIELD: Record<ChatOptimField, JobKind> = {
  title: 'kie_title',
  description: 'kie_description',
  tags: 'kie_tags'
};

/**
 * Run a synchronous Claude generation for one of the chat-driven fields.
 * Pricing is deterministic: the call is hard-capped at outputTokenCapFor()
 * so kie can never bill us more than what we already quoted the user, and
 * we debit exactly the quoted amount (estimateChatCredits) — no surprise
 * tail debits if the LLM ran a bit long.
 */
export async function runChatOptim(opts: ChatOptimRequest): Promise<ChatOptimResult> {
  const kie = getKieClient();

  const languageName = languageNameForPrompt(opts.languageCode);

  const built =
    opts.field === 'title'
      ? buildTitleRewritePrompt(opts.product, opts.userPrompt, languageName)
      : opts.field === 'description'
        ? buildDescriptionRewritePrompt(opts.product, opts.userPrompt, languageName)
        : buildTagSuggestionPrompt(opts.product, opts.userPrompt, languageName);

  const messages: ChatMessage[] = [{ role: 'user', content: built.user }];

  const model = getChatModel(opts.chatModelId);

  const response = await kie.chat({
    model: model.kieModelId,
    system: built.system,
    messages,
    max_tokens: outputTokenCapFor(opts.field)
  });

  const text = KieClient.extractText(response);
  const output: string | string[] = opts.field === 'tags' ? parseTags(text) : text;

  // Quoted = debited. The user paid for the cap; whether kie's actual
  // credits_consumed lands a bit under the cap is our buffer/upside.
  const debit = estimateChatCredits(model.id, opts.field);

  const jobId = randomUUID();
  const now = new Date();

  await db.insert(jobs).values({
    id: jobId,
    projectId: opts.projectId,
    kind: KIND_BY_FIELD[opts.field],
    status: 'completed',
    inputPayload: {
      productSourceId: opts.productSourceId,
      field: opts.field,
      userPrompt: opts.userPrompt,
      chatModelId: model.id
    },
    result: { output, raw: text, kieCreditsConsumed: response.credits_consumed },
    creditsCost: debit,
    startedAt: now,
    finishedAt: now
  });

  if (debit > 0) {
    await applyCreditTransaction({
      userId: opts.userId,
      delta: -debit,
      reason: KIND_BY_FIELD[opts.field],
      jobId,
      idempotencyKey: `job-${jobId}`
    });
  }

  return {
    jobId,
    field: opts.field,
    output,
    creditsConsumed: debit
  };
}

export interface OptimHistoryItem {
  jobId: string;
  field: ChatOptimField | 'images';
  userPrompt: string;
  output: string | string[];
  createdAt: Date;
}

/**
 * List recent generations for a (project, productSourceId, field) tuple,
 * newest first. Used by the product detail page to render history.
 */
export async function listOptimHistory(
  projectId: string,
  productSourceId: string,
  field: ChatOptimField | 'images'
): Promise<OptimHistoryItem[]> {
  const kind: JobKind | null =
    field === 'title'
      ? 'kie_title'
      : field === 'description'
        ? 'kie_description'
        : field === 'tags'
          ? 'kie_tags'
          : field === 'images'
            ? 'kie_image_edit'
            : null;
  if (!kind) return [];

  const candidates = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, kind),
      eq(jobs.status, 'completed')
    ),
    orderBy: [desc(jobs.createdAt)],
    limit: 20
  });

  return candidates
    .filter((j) => {
      const input = j.inputPayload as { productSourceId?: string } | null;
      return input?.productSourceId === productSourceId;
    })
    .map((j) => {
      const input = j.inputPayload as { userPrompt?: string } | null;
      // Image jobs store the kie payload directly (persistedUrls / resultUrls).
      // Chat jobs store { output, raw } with the parsed text/tags in `output`.
      let output: string | string[] = '';
      if (field === 'images') {
        const r = j.result as { persistedUrls?: string[]; resultUrls?: string[] } | null;
        output = r?.persistedUrls ?? r?.resultUrls ?? [];
      } else {
        const r = j.result as { output?: string | string[] } | null;
        output = r?.output ?? '';
      }
      return {
        jobId: j.id,
        field,
        userPrompt: input?.userPrompt ?? '',
        output,
        createdAt: j.createdAt
      };
    });
}

function parseTags(text: string): string[] {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string').slice(0, 30);
    }
  } catch {
    /* try bracket extraction */
  }
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((t): t is string => typeof t === 'string').slice(0, 30);
      }
    } catch {
      /* fallback */
    }
  }
  // Last-resort: split by comma or newline
  return trimmed
    .split(/[,\n]+/)
    .map((s) => s.trim().replace(/^["'-]+|["'-]+$/g, ''))
    .filter(Boolean)
    .slice(0, 20);
}
