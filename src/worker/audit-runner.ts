import { eq } from 'drizzle-orm';
import { processAudit } from '@/features/run-audit';
import { db } from '@/shared/db';
import { audits } from '@/shared/db/schema';

const MAX_CONCURRENT = 3;

/**
 * Drain a batch of pending audits. Called every tick by the worker loop.
 * Each audit's processAudit() is idempotent and self-contained, so concurrent
 * processing across worker replicas is safe (worst case: redundant work).
 */
export async function runAuditRunner(): Promise<void> {
  const pending = await db.query.audits.findMany({
    where: eq(audits.status, 'pending'),
    limit: MAX_CONCURRENT
  });
  if (pending.length === 0) return;

  console.log(`[audit-runner] processing ${pending.length} pending audit(s)`);
  await Promise.all(
    pending.map((a) =>
      processAudit(a.id).catch((e) => {
        console.error(`[audit-runner] ${a.id} crashed:`, e);
      })
    )
  );
}
