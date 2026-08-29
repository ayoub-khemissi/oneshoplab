import { eq } from 'drizzle-orm';
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

export type CreditBucket = 'subscription' | 'pack';

export interface CreditTxOptions {
  userId: string;
  /** Signed integer. Positive = grant, negative = consume. Ignored when
   *  `setSubscriptionTo` is provided (the helper computes the implied
   *  delta itself for the audit row). */
  delta: number;
  reason: string;
  jobId?: string | null;
  stripePaymentId?: string | null;
  /** Unique key to make this transaction idempotent across retries/webhooks. */
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * For grants only (delta > 0): which bucket the credits land in.
   * - 'subscription' (default for grants): wiped out on next subscription
   *   renewal. Use for monthly plan grants.
   * - 'pack': accumulates indefinitely. Use for one-time pack purchases
   *   and any other "earned" credits we want to protect.
   * Has no effect on debits — debits always drain subscription first,
   * pack second.
   */
  bucket?: CreditBucket;
  /**
   * Use-it-or-lose-it: replace the user's subscription bucket with this
   * exact value (typical for monthly renewals). The audit row records the
   * net delta needed to reach that target so the trail stays consistent
   * with `delta`-style entries elsewhere.
   * When set, the `delta` field is ignored.
   */
  setSubscriptionTo?: number;
  /**
   * For debits (delta < 0) only. When true, clamp the deduction to the
   * available balance instead of throwing InsufficientCreditsError if
   * the user has already burned through some of the credits we're now
   * trying to revoke (typical of refund flows: customer used 400 of a
   * 500-pack then asks for a partial refund — we revoke what's still
   * there and let the rest go). The audit row records the actual
   * deducted amount in `delta` plus a `shortfall` metadata field so the
   * gap stays auditable.
   */
  allowShortfall?: boolean;
}

export interface CreditTxResult {
  newBalance: number;
  alreadyApplied: boolean;
}

/**
 * Atomically apply a credit transaction.
 *
 * Two buckets share the spendable balance:
 *   - subscription: granted at the start of each billing period, RESET to
 *     plan.credits at the next renewal — use-it-or-lose-it.
 *   - pack: pack purchases + any non-expiring grants — never reset.
 *
 * Spends drain the subscription bucket first, then overflow onto pack.
 * The legacy `users.creditsBalance` column stays in sync with the sum so
 * existing reads (header chip, session token) need no refactor.
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

    // SELECT ... FOR UPDATE: serialize concurrent transactions on the same
    // user. Without the row lock, N parallel debits (e.g. "Generate all"
    // firing 3 image jobs at once) all read the same starting balance and
    // each write `balance - cost`, so only one debit survives (lost update)
    // — observed in prod: 9 images charged as 3, ledger out of sync with
    // the balance. The lock makes each tx wait for the previous commit and
    // re-read the fresh balance, so every debit lands exactly once.
    const [u] = await tx.select().from(users).where(eq(users.id, opts.userId)).for('update');
    if (!u) throw new Error(`User ${opts.userId} not found`);

    let nextSub = u.creditsBalanceSubscription;
    let nextPack = u.creditsBalancePack;
    let recordedDelta: number;
    const metadata: Record<string, unknown> = { ...(opts.metadata ?? {}) };

    if (typeof opts.setSubscriptionTo === 'number') {
      // Renewal-style reset. The audit row gets the net delta so the
      // running sum of `delta` over the user's transactions still matches
      // their balance.
      const target = Math.max(0, opts.setSubscriptionTo);
      recordedDelta = target - u.creditsBalanceSubscription;
      metadata.previousSubscriptionBalance = u.creditsBalanceSubscription;
      metadata.newSubscriptionBalance = target;
      metadata.bucket = 'subscription';
      metadata.kind = 'subscription_reset';
      nextSub = target;
    } else if (opts.delta > 0) {
      const bucket: CreditBucket = opts.bucket ?? 'subscription';
      if (bucket === 'pack') nextPack += opts.delta;
      else nextSub += opts.delta;
      metadata.bucket = bucket;
      recordedDelta = opts.delta;
    } else if (opts.delta < 0) {
      const need = -opts.delta;

      if (opts.bucket === 'pack') {
        // Pack-targeted debit (refund of a pack purchase). We only touch
        // the pack bucket — subscription credits are unrelated to the
        // refunded purchase and stay intact. allowShortfall is the
        // refund-flow knob that lets us record the partial revocation
        // when the customer has already spent some of those credits.
        const available = u.creditsBalancePack;
        if (available < need && !opts.allowShortfall) {
          throw new InsufficientCreditsError(need, available);
        }
        const taken = Math.min(available, need);
        nextPack -= taken;
        metadata.spentFromPack = taken;
        if (taken < need) metadata.shortfall = need - taken;
        recordedDelta = -taken;
      } else {
        const total = u.creditsBalanceSubscription + u.creditsBalancePack;
        if (total < need) throw new InsufficientCreditsError(need, total);
        const fromSub = Math.min(u.creditsBalanceSubscription, need);
        const fromPack = need - fromSub;
        nextSub -= fromSub;
        nextPack -= fromPack;
        metadata.spentFromSubscription = fromSub;
        metadata.spentFromPack = fromPack;
        recordedDelta = opts.delta;
      }
    } else {
      // delta === 0 and no setSubscriptionTo. No-op, but still record for
      // idempotency tracking.
      recordedDelta = 0;
    }

    const newTotal = nextSub + nextPack;

    await tx.insert(creditTransactions).values({
      id: randomUUID(),
      userId: opts.userId,
      delta: recordedDelta,
      reason: opts.reason,
      jobId: opts.jobId ?? null,
      stripePaymentId: opts.stripePaymentId ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      metadata
    });

    await tx
      .update(users)
      .set({
        creditsBalanceSubscription: nextSub,
        creditsBalancePack: nextPack,
        creditsBalance: newTotal
      })
      .where(eq(users.id, opts.userId));

    return { newBalance: newTotal, alreadyApplied: false };
  });
}

export interface CreditBucketsSnapshot {
  subscription: number;
  pack: number;
  total: number;
}

export async function getCreditBuckets(userId: string): Promise<CreditBucketsSnapshot> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) return { subscription: 0, pack: 0, total: 0 };
  return {
    subscription: u.creditsBalanceSubscription,
    pack: u.creditsBalancePack,
    total: u.creditsBalance
  };
}

export async function getCreditBalance(userId: string): Promise<number> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return u?.creditsBalance ?? 0;
}

/**
 * Static fallback cost per job kind. Used as a budget hint and ceiling check.
 * For chat jobs the actual debit comes from the deterministic field cap × the
 * markup (see estimateChatCredits) — these values are kept for the legacy
 * audit-runner path and image jobs where kie has a flat per-call cost.
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
  kie_dynamic_audit: 0,
  /** Parent of a bulk catalog generation. Children (chat / image) carry
   *  the actual credit cost; the parent row itself is purely for status
   *  tracking. */
  bulk_site_generate: 0
};

export function costForJob(kind: JobKind): number {
  return CREDIT_COST[kind] ?? 1;
}
