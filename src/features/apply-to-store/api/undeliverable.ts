import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { ackChange } from '@/entities/product-change';
import { db } from '@/shared/db';
import { apiKeys, productChanges, shopConnections } from '@/shared/db/schema';

/**
 * A change waits this long before we call it undeliverable. A token refresh, a
 * plugin being updated or a key rotated by hand all take seconds; failing a
 * change during one of those would be a lie the merchant has to undo.
 */
const GRACE_MS = 10 * 60 * 1000;
/** Bounded like every other sweep on the 5 s tick. */
const MAX_PER_PASS = 200;

/**
 * Every way a store can receive a change: an OAuth connector, or a plugin
 * holding a key that still works.
 *
 * The key rule is expressed in SQL rather than by loading the rows and asking
 * `isUsableKey`: this runs on every worker tick and once per approval, and the
 * question is "does one exist", not "which ones". It is the same rule as
 * `keyState` in the integrations slice — revoked, past its rotation grace, or
 * expired — and `tests/db/undeliverable-changes.test.ts` walks each of those
 * states to keep the two honest.
 */
async function canReceive(projectId: string): Promise<boolean> {
  const connection = await db.query.shopConnections.findFirst({
    where: and(eq(shopConnections.projectId, projectId), eq(shopConnections.status, 'connected')),
    columns: { id: true }
  });
  if (connection) return true;
  const now = new Date();
  const [usable] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.projectId, projectId),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.graceUntil), gt(apiKeys.graceUntil, now)),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))
      )
    )
    .limit(1);
  return usable != null;
}

/**
 * Stop trying to send what can no longer be sent.
 *
 * A pending change is a promise to write into a store. When the connection
 * goes — revoked token, uninstalled plugin, rotated key — the worker simply
 * stops picking that project up, and the change stays `pending` for ever: the
 * product page keeps saying "sending" about a delivery nobody is attempting,
 * and the merchant has no way to tell the difference between slow and dead.
 *
 * So the queue is drained the honest way: past the grace window, a change on a
 * store with no delivery path becomes `failed` with `store_disconnected`. That
 * is a state the merchant can see, act on and re-send from once the store is
 * connected again — unlike a queue that never moves.
 */
export async function failUndeliverableChanges(): Promise<number> {
  const stale = await db
    .select({ id: productChanges.id, projectId: productChanges.projectId })
    .from(productChanges)
    .where(
      and(
        eq(productChanges.status, 'pending'),
        lt(productChanges.approvedAt, new Date(Date.now() - GRACE_MS))
      )
    )
    .limit(MAX_PER_PASS);
  if (stale.length === 0) return 0;

  // One check per project, not one per change: a store with 300 queued
  // changes is exactly the case this runs on.
  const byProject = new Map<string, string[]>();
  for (const row of stale) {
    byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.id]);
  }

  let failed = 0;
  for (const [projectId, ids] of byProject) {
    if (await canReceive(projectId)) continue;
    for (const id of ids) {
      await ackChange(projectId, id, { status: 'failed', error: 'store_disconnected' });
      failed += 1;
    }
  }
  if (failed > 0) {
    console.info(`[undeliverable] failed ${failed} change(s) with nowhere to go`);
  }
  return failed;
}

/** The same question, for the one place that must refuse before queueing. */
export async function projectCanReceiveChanges(projectId: string): Promise<boolean> {
  return canReceive(projectId);
}

/** Kept for the tests: the window a change is given before we give up on it. */
export const UNDELIVERABLE_GRACE_MS = GRACE_MS;
