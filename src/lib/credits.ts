import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { creditTransactions, users, type JobKind } from './db/schema';

export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public available: number
  ) {
    super(`Insufficient credits: needed ${required}, have ${available}`);
    this.name = 'InsufficientCreditsError';
  }
}

export interface CreditTxOptions {
  userId: string;
  /** Signed integer. Positive = grant. Negative = consume. */
  delta: number;
  reason: string;
  jobId?: string | null;
  stripePaymentId?: string | null;
  /** Unique key to make this transaction idempotent across retries/webhooks. */
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreditTxResult {
  newBalance: number;
  alreadyApplied: boolean;
}

/**
 * Atomically apply a credit transaction:
 *   - Insert a row in credit_transactions (idempotent via idempotencyKey).
 *   - Update users.creditsBalance.
 *   - Reject negative deltas that would push the balance below zero.
 */
export async function applyCreditTransaction(opts: CreditTxOptions): Promise<CreditTxResult> {
  return db.transaction(async (tx) => {
    if (opts.idempotencyKey) {
      const existing = await tx.query.creditTransactions.findFirst({
        where: eq(creditTransactions.idempotencyKey, opts.idempotencyKey)
      });
      if (existing) {
        const u = await tx.query.users.findFirst({ where: eq(users.id, opts.userId) });
        return { newBalance: u?.creditsBalance ?? 0, alreadyApplied: true };
      }
    }

    const u = await tx.query.users.findFirst({ where: eq(users.id, opts.userId) });
    if (!u) throw new Error(`User ${opts.userId} not found`);

    if (opts.delta < 0 && u.creditsBalance + opts.delta < 0) {
      throw new InsufficientCreditsError(-opts.delta, u.creditsBalance);
    }

    await tx.insert(creditTransactions).values({
      id: randomUUID(),
      userId: opts.userId,
      delta: opts.delta,
      reason: opts.reason,
      jobId: opts.jobId ?? null,
      stripePaymentId: opts.stripePaymentId ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      metadata: opts.metadata ?? null
    });

    await tx
      .update(users)
      .set({ creditsBalance: sql`${users.creditsBalance} + ${opts.delta}` })
      .where(eq(users.id, opts.userId));

    return { newBalance: u.creditsBalance + opts.delta, alreadyApplied: false };
  });
}

export async function getCreditBalance(userId: string): Promise<number> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return u?.creditsBalance ?? 0;
}

/**
 * Cost of each job kind in credits. Centralized so billing changes happen
 * in one place. Audit runs are free (run on our infra, no kie call).
 */
/**
 * Static fallback cost per job kind. Used as a budget hint and ceiling check.
 * For chat jobs the actual debit comes from `credits_consumed` in the kie
 * response (we trust kie's metering), so these values mostly matter for
 * the image jobs where kie doesn't return an inline cost.
 */
export const CREDIT_COST: Record<JobKind, number> = {
  audit_run: 0,
  kie_prompt_suggest: 1,
  kie_alt_text: 1,
  kie_title: 1,
  kie_description: 5,
  kie_tags: 2,
  kie_image_edit: 20,
  kie_image_generate: 25,
  /** Dynamic audit chat is run on our infra for the public report — not
   *  debited to a user, just budgeted. */
  kie_dynamic_audit: 0
};

export function costForJob(kind: JobKind): number {
  return CREDIT_COST[kind] ?? 1;
}
