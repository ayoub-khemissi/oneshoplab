import { and, eq, inArray, sum } from 'drizzle-orm';
import { APP_STORE_TEST_CREDIT_CAP } from '@/entities/ai-model';
import { db } from '@/shared/db';
import { creditTransactions } from '@/shared/db/schema';
import { applyCreditTransaction } from './ledger';

/** Ledger reasons of test grants — Shopify's predates the shared cap. */
export const TEST_GRANT_REASONS = ['shopify_test_grant', 'wix_test_grant'] as const;
export type TestGrantReason = (typeof TEST_GRANT_REASONS)[number];

/**
 * App-store test purchases (Shopify development stores, Wix plans at 0.00
 * before approval) prove the flow, not a payment. They activate the plan or
 * pack, but their credits are capped per account — across both stores, so
 * one account cannot fill up twice — and never refilled. Otherwise any
 * partner account would get plans and packs for free.
 */
export async function grantTestCredits(input: {
  userId: string;
  requested: number;
  reason: TestGrantReason;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}): Promise<number> {
  const [row] = await db
    .select({ s: sum(creditTransactions.delta) })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, input.userId),
        inArray(creditTransactions.reason, [...TEST_GRANT_REASONS])
      )
    );
  const already = Number(row?.s ?? 0);
  const amount = Math.min(input.requested, Math.max(0, APP_STORE_TEST_CREDIT_CAP - already));
  if (amount <= 0) return 0;
  await applyCreditTransaction({
    userId: input.userId,
    delta: amount,
    bucket: 'pack',
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    metadata: { ...input.metadata, requested: input.requested, test: true }
  });
  return amount;
}
