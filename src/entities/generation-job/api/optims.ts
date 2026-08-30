import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction } from '@/entities/credit';
import { db } from '@/lib/db';
import { jobs, products, type JobKind } from '@/lib/db/schema';
import { transitionJob } from './transitions';
import { languageNameForPrompt } from '@/lib/i18n/languages';
import { notify } from '@/lib/notifications';
import { chatCompletion } from '@/entities/ai-provider';
import type { ChatMessage } from '@/entities/ai-provider';
import {
  estimateChatCredits,
  getChatModel,
  outputTokenCapFor,
  type ChatModelId
} from '@/entities/ai-model';
import {
  buildDescriptionRewritePrompt,
  buildTagSuggestionPrompt,
  buildTitleRewritePrompt,
  type ProductContext
} from '../lib/prompts';
import type { ChatOptimField } from '../model/types';

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
  const languageName = languageNameForPrompt(opts.languageCode);

  const built =
    opts.field === 'title'
      ? buildTitleRewritePrompt(opts.product, opts.userPrompt, languageName)
      : opts.field === 'description'
        ? buildDescriptionRewritePrompt(opts.product, opts.userPrompt, languageName)
        : buildTagSuggestionPrompt(opts.product, opts.userPrompt, languageName);

  const messages: ChatMessage[] = [{ role: 'user', content: built.user }];

  const model = getChatModel(opts.chatModelId);

  // Decouple the kie max_tokens from the pricing cap. pricing.json's
  // outputTokens drives what we CHARGE the user (deterministic), but
  // we send a much larger ceiling to kie so the prompt's length
  // instruction is the real constraint and the output never gets cut
  // mid-word / mid-sentence. The 2.5x multiplier leaves a generous
  // headroom (e.g. a description priced for 600 tokens has a 1500
  // safety cap — a hard upper bound the model never reaches when it
  // follows the "180-220 words" prompt instruction). Worst-case
  // margin is still ~35% on Opus, ~50% on Sonnet, so a verbose
  // generation doesn't push us into the red.
  const SAFETY_MULTIPLIER = 2.5;
  const safetyMaxTokens = Math.ceil(outputTokenCapFor(opts.field) * SAFETY_MULTIPLIER);

  // Resolve the product UUID from (projectId, sourceId) so we can
  // populate the FK column — the past-generations strip and the
  // site Activity tab both pull the product link via the `product`
  // relation on jobs, which joins on jobs.product_id.
  const productRow = await db.query.products.findFirst({
    where: and(eq(products.projectId, opts.projectId), eq(products.sourceId, opts.productSourceId)),
    columns: { id: true }
  });

  // Insert the job row in 'running' BEFORE calling kie so the product
  // page can detect an in-flight chat after an F5 (chat is sync ~30s,
  // and the original client fetch is aborted on reload). The row
  // becomes the persistent "I'm generating X" marker the UI restores
  // from on remount.
  const jobId = randomUUID();
  const startedAt = new Date();
  await db.insert(jobs).values({
    id: jobId,
    projectId: opts.projectId,
    productId: productRow?.id ?? null,
    kind: KIND_BY_FIELD[opts.field],
    status: 'running',
    inputPayload: {
      productSourceId: opts.productSourceId,
      field: opts.field,
      userPrompt: opts.userPrompt,
      chatModelId: model.id
    },
    startedAt
  });

  let response;
  try {
    response = await chatCompletion({
      model,
      system: built.system,
      messages,
      max_tokens: safetyMaxTokens
    });
  } catch (e) {
    // Flip the marker out of 'running' so the UI's poll loop stops
    // spinning forever and the user sees the failure state on next
    // refresh. Error message stays raw in the DB for ops debugging;
    // the user-facing layer sanitises before display.
    await transitionJob(db, jobId, 'failed', { error: (e as Error).message });
    // Log the failure to the notification stream. isRead=false because
    // we don't know yet whether the user sees a toast — if the route
    // handler returns to a still-mounted client the toast WILL fire
    // and the client will mark this read; if not (F5'd away), the
    // bell badge ticks up so the merchant sees it on their next visit.
    await notify({
      userId: opts.userId,
      kind: 'chat_failed',
      jobId,
      productId: productRow?.id ?? null,
      projectId: opts.projectId,
      payload: { field: opts.field, errorMessage: (e as Error).message }
    });
    throw e;
  }

  const text = response.text;
  const output: string | string[] = opts.field === 'tags' ? parseTags(text) : text;

  // Quoted = debited. The user paid for the cap; whether kie's actual
  // credits_consumed lands a bit under the cap is our buffer/upside.
  const debit = estimateChatCredits(model.id, opts.field);
  const now = new Date();

  await transitionJob(db, jobId, 'completed', {
    result: {
      output,
      raw: text,
      providerUnitsConsumed: response.creditsConsumed,
      provider: response.provider,
      providerModel: response.model
    },
    creditsCost: debit,
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

  // Log the success to the notification stream. Same isRead=false
  // default as the failure path — the client decides whether to flip
  // it after firing the success toast. Preview = first ~80 chars of
  // the generated output (HTML stripped on description, comma-joined
  // top-5 on tags), so the bell dropdown renders "Titre : Tee-Shirt
  // Orange et Blanc" rather than the bare field name.
  await notify({
    userId: opts.userId,
    kind: 'chat_completed',
    jobId,
    productId: productRow?.id ?? null,
    projectId: opts.projectId,
    payload: { field: opts.field, preview: previewFor(opts.field, output) }
  });

  return {
    jobId,
    field: opts.field,
    output,
    creditsConsumed: debit
  };
}

/** Build the short preview string the notification dropdown shows
 *  next to the field label. ~80-char cap; strips HTML on the
 *  description field so a freshly-generated <p><strong>… doesn't end
 *  up as literal markup in the bell. Tags get a comma-joined top-5
 *  truncation. */
function previewFor(field: ChatOptimField, output: string | string[]): string {
  if (field === 'tags') {
    const arr = Array.isArray(output) ? output : [];
    return arr.slice(0, 5).join(', ');
  }
  if (typeof output !== 'string') return '';
  const plain = output
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= 80) return plain;
  return plain.slice(0, 80).trimEnd();
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
