import { languageNameForPrompt } from '@/shared/i18n';
import type { ChatMessage } from '@/entities/ai-provider';
import {
  estimateChatCredits,
  getChatModel,
  outputTokenCapFor,
  type ChatModelId
} from '@/entities/ai-model';
import type { JobKind } from '@/shared/db/schema';
import {
  buildDescriptionRewritePrompt,
  buildTagSuggestionPrompt,
  buildTitleRewritePrompt,
  type ProductContext
} from '../lib/prompts';
import type { CopyOptimField } from '../model/types';
import { runChatJob } from './chat-job';

export interface ChatOptimRequest {
  userId: string;
  projectId: string;
  productSourceId: string;
  field: CopyOptimField;
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
  field: CopyOptimField;
  /** string for title/description (HTML for description), string[] for tags. */
  output: string | string[];
  creditsConsumed: number;
}

const KIND_BY_FIELD: Record<CopyOptimField, JobKind> = {
  title: 'kie_title',
  description: 'kie_description',
  tags: 'kie_tags'
};

/**
 * Run a synchronous generation for one of the chat-driven fields. Pricing is
 * deterministic: the call is hard-capped and we debit exactly the quoted
 * amount (estimateChatCredits) — no surprise tail debits if the LLM ran long.
 * The job lifecycle and the ledger call live in runChatJob.
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

  // Decouple the provider's max_tokens from the pricing cap. pricing.json's
  // outputTokens drives what we CHARGE the user (deterministic), but we send a
  // much larger ceiling so the prompt's length instruction is the real
  // constraint and the output never gets cut mid-word. The 2.5x multiplier
  // leaves generous headroom (a description priced for 600 tokens has a 1500
  // safety cap — an upper bound the model never reaches when it follows the
  // "180-220 words" instruction). Worst-case margin is still ~35% on Opus,
  // ~50% on Sonnet, so a verbose generation doesn't push us into the red.
  const SAFETY_MULTIPLIER = 2.5;

  const run = await runChatJob<string | string[]>({
    userId: opts.userId,
    projectId: opts.projectId,
    productSourceId: opts.productSourceId,
    kind: KIND_BY_FIELD[opts.field],
    inputPayload: { field: opts.field, userPrompt: opts.userPrompt },
    model,
    system: built.system,
    messages,
    maxTokens: Math.ceil(outputTokenCapFor(opts.field) * SAFETY_MULTIPLIER),
    debit: estimateChatCredits(model.id, opts.field),
    parse: (text) => (opts.field === 'tags' ? parseTags(text) : text),
    notifications: {
      field: opts.field,
      preview: (output) => previewFor(opts.field, output as string | string[])
    }
  });

  return {
    jobId: run.jobId,
    field: opts.field,
    output: run.output,
    creditsConsumed: run.creditsConsumed
  };
}

/** Build the short preview string the notification dropdown shows next to the
 *  field label. ~80-char cap; strips HTML on the description field so a
 *  freshly-generated <p><strong>… doesn't end up as literal markup in the
 *  bell. Tags get a comma-joined top-5 truncation. */
function previewFor(field: CopyOptimField, output: string | string[]): string {
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
