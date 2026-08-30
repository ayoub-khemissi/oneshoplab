/**
 * One-shot ledger repair after the concurrent-debit race in
 * applyCreditTransaction (fixed 2026-08-28 with SELECT ... FOR UPDATE).
 *
 * Symptom: N parallel image holds read the same balance → only one debit
 * survived in users.creditsBalance, and 1-in-N ledger rows was lost to a
 * deadlock rollback while the job row (creditsCost > 0) stayed.
 *
 * Repair, per user:
 *   1. Every job with creditsCost > 0 and no `job-<id>` ledger row gets
 *      its missing debit row (reason = job kind, flagged reconciliation).
 *   2. If the resulting ledger sum is negative (user consumed more than
 *      they ever held), add a positive `reconciliation_adjustment` so the
 *      sum is 0 — we never store a negative balance.
 *   3. Set users.{creditsBalanceSubscription,creditsBalancePack,creditsBalance}
 *      so that total == ledger sum, taking the reduction from the
 *      subscription bucket first (same order a real debit uses).
 *
 * Writes users.creditsBalance directly ON PURPOSE — this is the ledger
 * repair the CLAUDE.md landmine is guarding; it re-establishes the
 * invariant balance == SUM(delta) rather than violating it.
 *
 *   pnpm tsx scripts/reconcile-credit-ledger.ts            # dry-run
 *   pnpm tsx scripts/reconcile-credit-ledger.ts --apply
 */
import { existsSync, readFileSync } from 'node:fs';
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (k && !(k in process.env)) process.env[k] = v;
  }
}
const APPLY = process.argv.includes('--apply');

async function main() {
  const { randomUUID } = await import('node:crypto');
  const { db } = await import('@/shared/db');
  const { users, projects, jobs, creditTransactions } = await import('@/shared/db/schema');
  const { eq, and, inArray, sql, like } = await import('drizzle-orm');
  const TAG = { reconciliation: '2026-08-28', cause: 'concurrent-debit race (pre FOR UPDATE)' };

  console.log(`[reconcile] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  const all = await db.select().from(users);
  for (const u of all) {
    const projIds = (
      await db.select({ id: projects.id }).from(projects).where(eq(projects.userId, u.id))
    ).map((p) => p.id);
    const paid = projIds.length
      ? await db
          .select({ id: jobs.id, kind: jobs.kind, cost: jobs.creditsCost, at: jobs.createdAt })
          .from(jobs)
          .where(and(inArray(jobs.projectId, projIds), sql`${jobs.creditsCost} > 0`))
      : [];
    const covered = new Set(
      (
        await db
          .select({ k: creditTransactions.idempotencyKey })
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.userId, u.id),
              like(creditTransactions.idempotencyKey, 'job-%')
            )
          )
      ).map((r) => r.k)
    );
    const orphans = paid.filter((j) => !covered.has(`job-${j.id}`));
    const [{ sum0 }] = (await db
      .select({ sum0: sql<number>`COALESCE(SUM(${creditTransactions.delta}),0)` })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, u.id))) as Array<{ sum0: number }>;
    const missing = orphans.reduce((a, j) => a + j.cost, 0);
    let ledgerAfter = Number(sum0) - missing;
    const adjustment = ledgerAfter < 0 ? -ledgerAfter : 0;
    ledgerAfter += adjustment;

    const cur = u.creditsBalanceSubscription + u.creditsBalancePack;
    const consistent =
      orphans.length === 0 && Number(sum0) === u.creditsBalance && cur === u.creditsBalance;
    console.log(`${u.email}  plan=${u.plan}`);
    console.log(
      `   balance=${u.creditsBalance} (sub=${u.creditsBalanceSubscription} pack=${u.creditsBalancePack})  ledger=${Number(sum0)}  orphan jobs=${orphans.length} (${missing} cr)`
    );
    if (consistent) {
      console.log('   ✓ cohérent, rien à faire\n');
      continue;
    }
    for (const j of orphans)
      console.log(
        `     - ${new Date(j.at).toISOString().slice(0, 16)} ${j.kind} ${j.cost} cr  job=${j.id.slice(0, 8)}`
      );
    // new buckets: reduce from subscription first
    let sub = u.creditsBalanceSubscription,
      pack = u.creditsBalancePack;
    const target = ledgerAfter;
    if (target < cur) {
      let cut = cur - target;
      const fromSub = Math.min(sub, cut);
      sub -= fromSub;
      cut -= fromSub;
      pack -= cut;
    } else if (target > cur) {
      pack += target - cur;
    }
    console.log(
      `   → ledger après réparation=${ledgerAfter}${adjustment ? ` (dont ajustement +${adjustment} pour ne pas être négatif)` : ''}  balance ${u.creditsBalance} → ${target} (sub=${sub} pack=${pack})`
    );

    if (!APPLY) {
      console.log('');
      continue;
    }
    await db.transaction(async (tx) => {
      for (const j of orphans) {
        await tx.insert(creditTransactions).values({
          id: randomUUID(),
          userId: u.id,
          delta: -j.cost,
          reason: j.kind,
          jobId: j.id,
          idempotencyKey: `job-${j.id}`,
          metadata: { ...TAG, note: 'missing debit row re-inserted' }
        });
      }
      if (adjustment > 0) {
        await tx.insert(creditTransactions).values({
          id: randomUUID(),
          userId: u.id,
          delta: adjustment,
          reason: 'reconciliation_adjustment',
          jobId: null,
          idempotencyKey: `reconcile-2026-08-28-${u.id}`,
          metadata: { ...TAG, note: 'consumed more than held; floor balance at 0' }
        });
      }
      await tx
        .update(users)
        .set({ creditsBalanceSubscription: sub, creditsBalancePack: pack, creditsBalance: target })
        .where(eq(users.id, u.id));
    });
    console.log('   ✓ appliqué\n');
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
