/**
 * The one place a synchronous, debited chat generation happens.
 *
 * Extracted from `runChatOptim` when alt-text generation arrived: both need
 * the same five steps in the same order — resolve the product FK, insert the
 * job row in `running` BEFORE calling the provider, call it, debit exactly
 * what was quoted, transition to `completed`. Duplicating that would have
 * meant a second copy of the ledger call, which is exactly what CLAUDE.md's
 * credits landmine forbids.
 *
 * Pricing determinism lives with the caller: it passes the `debit` it already
 * quoted the user (estimateChatCredits) and the `maxTokens` ceiling. This
 * module never decides a price.
 */
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { chatCompletion, type ChatMessage } from '@/entities/ai-provider';
import type { ChatModelRef } from '@/entities/ai-model';
import { applyCreditTransaction } from '@/entities/credit';
import { notify } from '@/entities/notification';
import { db } from '@/shared/db';
import { jobs, products, type JobKind } from '@/shared/db/schema';
import { transitionJob } from './transitions';

/**
 * Bell entries for this job. Omitted entirely by callers that fan out — one
 * notification per generated alt text would bury the merchant's real events
 * under 25 rows for a single click (the UI reports the batch itself).
 */
export interface ChatJobNotifications {
  /** `payload.field`, read by the bell to label the entry. */
  field: string;
  /** Short excerpt shown next to the label. */
  preview: (output: unknown) => string;
}

export interface ChatJobRequest<T> {
  userId: string;
  projectId: string;
  productSourceId: string;
  kind: JobKind;
  /** Merged into `jobs.input_payload` next to `productSourceId`. */
  inputPayload: Record<string, unknown>;
  model: ChatModelRef & { id: string };
  system: string;
  messages: ChatMessage[];
  /** Hard ceiling sent to the provider — NOT the pricing basis. */
  maxTokens: number;
  /** Credits to debit on success. Quoted to the user before the call. */
  debit: number;
  /** Provider text → the value stored on `jobs.result.output`. */
  parse: (text: string) => T;
  notifications?: ChatJobNotifications;
}

export interface ChatJobResult<T> {
  jobId: string;
  /** `products.id` when the source id resolved to a row, null otherwise. */
  productId: string | null;
  output: T;
  raw: string;
  creditsConsumed: number;
}

export async function runChatJob<T>(opts: ChatJobRequest<T>): Promise<ChatJobResult<T>> {
  // Resolve the product UUID from (projectId, sourceId) so we can populate the
  // FK column — the past-generations strip and the site Activity tab both pull
  // the product link via the `product` relation on jobs.
  const productRow = await db.query.products.findFirst({
    where: and(eq(products.projectId, opts.projectId), eq(products.sourceId, opts.productSourceId)),
    columns: { id: true }
  });
  const productId = productRow?.id ?? null;

  // Insert the job row in 'running' BEFORE calling the provider so the product
  // page can detect an in-flight generation after an F5 (chat is sync ~30s and
  // the original client fetch is aborted on reload).
  const jobId = randomUUID();
  await db.insert(jobs).values({
    id: jobId,
    projectId: opts.projectId,
    productId,
    kind: opts.kind,
    status: 'running',
    inputPayload: {
      productSourceId: opts.productSourceId,
      chatModelId: opts.model.id,
      ...opts.inputPayload
    },
    startedAt: new Date()
  });

  let response;
  try {
    response = await chatCompletion({
      model: opts.model,
      system: opts.system,
      messages: opts.messages,
      max_tokens: opts.maxTokens
    });
  } catch (e) {
    // Flip the marker out of 'running' so the UI's poll loop stops spinning
    // forever. The error stays raw in the DB for ops debugging; the
    // user-facing layer sanitises before display.
    await transitionJob(db, jobId, 'failed', { error: (e as Error).message });
    if (opts.notifications) {
      // isRead=false: if the route handler returns to a still-mounted client
      // the toast fires and the client marks this read; if the merchant F5'd
      // away, the bell badge ticks so they see it on their next visit.
      await notify({
        userId: opts.userId,
        kind: 'chat_failed',
        jobId,
        productId,
        projectId: opts.projectId,
        payload: { field: opts.notifications.field, errorMessage: (e as Error).message }
      });
    }
    throw e;
  }

  const raw = response.text;
  const output = opts.parse(raw);

  await transitionJob(db, jobId, 'completed', {
    result: {
      output,
      raw,
      providerUnitsConsumed: response.creditsConsumed,
      provider: response.provider,
      providerModel: response.model
    },
    creditsCost: opts.debit,
    finishedAt: new Date()
  });

  // Quoted = debited. The user paid for the cap; whether the provider's actual
  // consumption lands under it is our buffer/upside.
  if (opts.debit > 0) {
    await applyCreditTransaction({
      userId: opts.userId,
      delta: -opts.debit,
      reason: opts.kind,
      jobId,
      idempotencyKey: `job-${jobId}`
    });
  }

  if (opts.notifications) {
    await notify({
      userId: opts.userId,
      kind: 'chat_completed',
      jobId,
      productId,
      projectId: opts.projectId,
      payload: { field: opts.notifications.field, preview: opts.notifications.preview(output) }
    });
  }

  return { jobId, productId, output, raw, creditsConsumed: opts.debit };
}
