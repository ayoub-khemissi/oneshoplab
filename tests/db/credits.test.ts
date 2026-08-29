/**
 * The credit ledger is the money path. Invariants under test:
 *   1. balance == SUM(ledger.delta) after any sequence of operations
 *   2. N concurrent debits never lose an update (SELECT … FOR UPDATE)
 *   3. an idempotency key applies exactly once, even under concurrency
 *   4. debits drain subscription before pack; pack refunds may shortfall
 *   5. renewals reset the subscription bucket without touching packs
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applyCreditTransaction, InsufficientCreditsError } from '@/lib/credits';
import { db } from '@/lib/db';
import { buckets, createUser, ledgerCount, ledgerSum, resetTables } from './helpers';

beforeEach(resetTables);
afterAll(async () => {
  await db.$client.end();
});

describe('applyCreditTransaction', () => {
  it('keeps balance == SUM(ledger) across grants and debits', async () => {
    const userId = await createUser();
    await applyCreditTransaction({ userId, delta: 100, reason: 'grant' });
    await applyCreditTransaction({ userId, delta: 50, reason: 'pack', bucket: 'pack' });
    await applyCreditTransaction({ userId, delta: -30, reason: 'job' });
    await applyCreditTransaction({ userId, delta: -90, reason: 'job' });
    const b = await buckets(userId);
    expect(b).toEqual({ total: 30, sub: 0, pack: 30 });
    expect(await ledgerSum(userId)).toBe(b.total);
  });

  it('serialises concurrent debits: every one lands exactly once', async () => {
    const userId = await createUser({ sub: 1000 });
    const N = 12;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        applyCreditTransaction({ userId, delta: -21, reason: `img-${i}` })
      )
    );
    const b = await buckets(userId);
    expect(b.total).toBe(1000 - 21 * N);
    expect(await ledgerSum(userId)).toBe(b.total);
    expect(await ledgerCount(userId)).toBe(N);
  });

  it('never overspends under concurrency: exactly floor(balance/cost) debits succeed', async () => {
    const userId = await createUser({ sub: 100 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        applyCreditTransaction({ userId, delta: -30, reason: `job-${i}` })
      )
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const refused = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof InsufficientCreditsError
    ).length;
    expect(ok).toBe(3);
    expect(refused).toBe(7);
    const b = await buckets(userId);
    expect(b.total).toBe(10);
    expect(await ledgerSum(userId)).toBe(10);
  });

  it('applies an idempotency key once (sequential replay)', async () => {
    const userId = await createUser();
    const first = await applyCreditTransaction({
      userId,
      delta: 500,
      reason: 'pack',
      bucket: 'pack',
      idempotencyKey: 'pack-cs_1'
    });
    const replay = await applyCreditTransaction({
      userId,
      delta: 500,
      reason: 'pack',
      bucket: 'pack',
      idempotencyKey: 'pack-cs_1'
    });
    expect(first.alreadyApplied).toBe(false);
    expect(replay).toEqual({ newBalance: 500, alreadyApplied: true });
    expect(await ledgerCount(userId)).toBe(1);
  });

  it('applies an idempotency key once even when replays race', async () => {
    const userId = await createUser();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        applyCreditTransaction({
          userId,
          delta: 500,
          reason: 'pack',
          bucket: 'pack',
          idempotencyKey: 'pack-cs_race'
        })
      )
    );
    // Whatever happens to the losers (alreadyApplied or a rejected race),
    // the money must be granted exactly once.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await buckets(userId)).toMatchObject({ total: 500, pack: 500 });
    expect(await ledgerCount(userId)).toBe(1);
  });

  it('drains subscription first, then pack, and records the split', async () => {
    const userId = await createUser({ sub: 10, pack: 50 });
    await applyCreditTransaction({ userId, delta: -25, reason: 'job' });
    expect(await buckets(userId)).toEqual({ total: 35, sub: 0, pack: 35 });
    const rows = await db.query.creditTransactions.findMany();
    expect(rows.find((r) => r.reason === 'job')?.metadata).toMatchObject({
      spentFromSubscription: 10,
      spentFromPack: 15
    });
  });

  it('refuses a debit above the total balance without touching the ledger', async () => {
    const userId = await createUser({ sub: 5, pack: 5 });
    await expect(
      applyCreditTransaction({ userId, delta: -11, reason: 'job' })
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await buckets(userId)).toEqual({ total: 10, sub: 5, pack: 5 });
    expect(await ledgerCount(userId)).toBe(0);
  });

  it('pack refund with allowShortfall revokes what is left and audits the gap', async () => {
    const userId = await createUser({ sub: 40, pack: 100 });
    await applyCreditTransaction({ userId, delta: -80, reason: 'job' }); // sub 0, pack 60
    await applyCreditTransaction({
      userId,
      delta: -100,
      reason: 'refund',
      bucket: 'pack',
      allowShortfall: true
    });
    const b = await buckets(userId);
    expect(b).toEqual({ total: 0, sub: 0, pack: 0 });
    expect(await ledgerSum(userId)).toBe(0);
    const rows = await db.query.creditTransactions.findMany();
    const refund = rows.find((r) => r.reason === 'refund');
    expect(refund?.delta).toBe(-60);
    expect(refund?.metadata).toMatchObject({ shortfall: 40 });
  });

  it('renewal resets the subscription bucket only and keeps the ledger consistent', async () => {
    const userId = await createUser({ sub: 123, pack: 77 });
    await applyCreditTransaction({ userId, delta: 0, reason: 'renewal', setSubscriptionTo: 500 });
    expect(await buckets(userId)).toEqual({ total: 577, sub: 500, pack: 77 });
    expect(await ledgerSum(userId)).toBe(577);
    const rows = await db.query.creditTransactions.findMany();
    expect(rows.find((r) => r.reason === 'renewal')?.delta).toBe(377);
  });
});
