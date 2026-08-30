import { randomUUID } from 'node:crypto';
import { and, eq, notLike, sql, sum } from 'drizzle-orm';
import { db } from '@/shared/db';
import { creditTransactions, users } from '@/shared/db/schema';

export async function resetTables(): Promise<void> {
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  for (const t of [
    'shop_connections',
    'gdpr_requests',
    'api_key_events',
    'api_keys',
    'api_idempotency',
    'catalog_sync_sessions',
    'product_changes',
    'credit_transactions',
    'legal_consents',
    'subscriptions',
    'password_reset_tokens',
    'contact_messages',
    'notifications',
    'share_links',
    'jobs',
    'audits',
    'products',
    'projects',
    'users'
  ]) {
    await db.execute(sql.raw(`TRUNCATE TABLE \`${t}\``));
  }
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
}

export async function createUser(opts: { sub?: number; pack?: number } = {}): Promise<string> {
  const id = randomUUID();
  const sub = opts.sub ?? 0;
  const pack = opts.pack ?? 0;
  await db.insert(users).values({
    id,
    email: `${id}@test.local`,
    creditsBalanceSubscription: sub,
    creditsBalancePack: pack,
    creditsBalance: sub + pack
  });
  // Seed rows so the invariant balance == SUM(ledger) holds from the start.
  const seeds = [
    { delta: sub, reason: 'seed_subscription', bucket: 'subscription' },
    { delta: pack, reason: 'seed_pack', bucket: 'pack' }
  ].filter((r) => r.delta > 0);
  if (seeds.length) {
    await db.insert(creditTransactions).values(
      seeds.map((r) => ({
        id: randomUUID(),
        userId: id,
        delta: r.delta,
        reason: r.reason,
        metadata: { bucket: r.bucket, seed: true }
      }))
    );
  }
  return id;
}

export async function buckets(userId: string) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) throw new Error('user vanished');
  return {
    total: u.creditsBalance,
    sub: u.creditsBalanceSubscription,
    pack: u.creditsBalancePack
  };
}

/** Sum of the ledger deltas — must always equal the balance. */
export async function ledgerSum(userId: string): Promise<number> {
  const [row] = await db
    .select({ s: sum(creditTransactions.delta) })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));
  return Number(row?.s ?? 0);
}

/** Number of ledger rows written by the code under test (seed rows excluded). */
export async function ledgerCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(creditTransactions)
    .where(
      and(eq(creditTransactions.userId, userId), notLike(creditTransactions.reason, 'seed_%'))
    );
  return Number(row?.n ?? 0);
}
