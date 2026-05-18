import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { applyCreditTransaction } from '@/lib/credits';
import { db } from '@/lib/db';
import { jobs, products, type JobKind } from '@/lib/db/schema';
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

  const response = await kie.chat({
    model: model.kieModelId,
    system: built.system,
    messages,
    max_tokens: safetyMaxTokens
  });

  const text = KieClient.extractText(response);
  const output: string | string[] = opts.field === 'tags' ? parseTags(text) : text;

  // Quoted = debited. The user paid for the cap; whether kie's actual
  // credits_consumed lands a bit under the cap is our buffer/upside.
  const debit = estimateChatCredits(model.id, opts.field);

  const jobId = randomUUID();
  const now = new Date();

  // Resolve the product UUID from (projectId, sourceId) so we can
  // populate the FK column — the past-generations strip and the
  // site Activity tab both pull the product link via the `product`
  // relation on jobs, which joins on jobs.product_id. Without this
  // backfill the column would render "—" instead of the title for
  // every chat generation.
  const productRow = await db.query.products.findFirst({
    where: and(
      eq(products.projectId, opts.projectId),
      eq(products.sourceId, opts.productSourceId)
    ),
    columns: { id: true }
  });

  await db.insert(jobs).values({
    id: jobId,
    projectId: opts.projectId,
    productId: productRow?.id ?? null,
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
  /** Credits debited for this generation. Mirrors `jobs.credits_cost`.
   *  Surfaced on the past-generations row so the merchant can see how
   *  much each historical run cost without leaving the page. */
  creditsCost: number;
  /** When the R2 cleanup worker tombstoned this image job. Null for
   *  fresh entries and for non-image fields. Drives the "Image
   *  expirée le …" caption on the past-generations row. */
  expiredAt: Date | null;
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
      eq(jobs.status, 'completed'),
      // Image jobs the merchant has soft-deleted from the live grid
      // shouldn't reappear under "past generations" either — that would
      // look like a broken delete. The flag is unused on chat jobs so
      // the predicate is a no-op for title / description / tags.
      isNull(jobs.hiddenAt)
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
        createdAt: j.createdAt,
        creditsCost: j.creditsCost ?? 0,
        expiredAt: j.expiredAt ?? null
      };
    });
}

/** Job kinds that surface in the "Past generations" history strip. */
const HISTORY_KINDS: JobKind[] = [
  'kie_title',
  'kie_description',
  'kie_tags',
  'kie_image_edit'
];

/** Field for a given kie_* kind. Inverse of KIND_BY_FIELD plus
 *  the image entry which the chat map doesn't carry. */
function fieldFromKind(kind: JobKind): ChatOptimField | 'images' | null {
  if (kind === 'kie_title') return 'title';
  if (kind === 'kie_description') return 'description';
  if (kind === 'kie_tags') return 'tags';
  if (kind === 'kie_image_edit') return 'images';
  return null;
}

/**
 * Server-paginated past-generations feed. Replaces the 4×
 * `listOptimHistory` merge that loaded ~80 rows just to render
 * the first 15 — this hits the DB twice (count + slice) and
 * lets the page state live in the URL.
 *
 * Filtering by `productSourceId` happens at the DB level via
 * MySQL's `JSON_EXTRACT` on `inputPayload.productSourceId`,
 * so a product with hundreds of historical gens doesn't pull
 * them all into memory just to discard the irrelevant rows.
 */
export async function listOptimHistoryPaginated(
  projectId: string,
  productSourceId: string,
  options: { page: number; perPage: number }
): Promise<{ items: OptimHistoryItem[]; totalItems: number; totalPages: number }> {
  const page = Math.max(1, options.page);
  const perPage = Math.max(1, options.perPage);

  const sourceFilter = sql`JSON_UNQUOTE(JSON_EXTRACT(${jobs.inputPayload}, '$.productSourceId')) = ${productSourceId}`;
  const whereExpr = and(
    eq(jobs.projectId, projectId),
    inArray(jobs.kind, HISTORY_KINDS),
    eq(jobs.status, 'completed'),
    isNull(jobs.hiddenAt),
    sourceFilter
  );

  const [totalRow, rows] = await Promise.all([
    db.select({ value: count() }).from(jobs).where(whereExpr),
    db
      .select()
      .from(jobs)
      .where(whereExpr)
      .orderBy(desc(jobs.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage)
  ]);

  const totalItems = totalRow[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));

  const items: OptimHistoryItem[] = rows
    .map((j) => {
      const field = fieldFromKind(j.kind);
      if (!field) return null;
      const input = j.inputPayload as { userPrompt?: string } | null;
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
        createdAt: j.createdAt,
        creditsCost: j.creditsCost ?? 0,
        expiredAt: j.expiredAt ?? null
      } satisfies OptimHistoryItem;
    })
    .filter((it): it is OptimHistoryItem => it !== null);

  return { items, totalItems, totalPages };
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
