/**
 * "Is the store still handing us its catalog?"
 *
 * Between connecting and the first score there is a window where everything is
 * fine and nothing looks it: the connection is live, the products are already
 * in our database, and the newest audit is the one that failed *before* the
 * connection existed. The dashboard read that audit and said "Audit échoué"
 * next to an empty product list. Measured at 114 seconds in production on
 * 2026-09-04, and it reads as a broken product, not as work in progress.
 *
 * So the page asks this instead, and shows "we are fetching your catalog".
 */

export interface CatalogArrivalInput {
  /** null when the project has no connector (manual, or plugin-driven). */
  connection: {
    status: string;
    pullPhase: string | null;
    pullRequestedAt: Date | null;
    lastPullAt: Date | null;
  } | null;
}

/**
 * True only while the store is ACTIVELY fetching: a pull is queued, running,
 * or has never happened.
 *
 * This deliberately says nothing about the audit. The first version compared
 * the newest audit's timestamp against the last pull, reasoning that an audit
 * older than the catalog could not describe it — and got stuck true forever,
 * because an audit asks the store for a fresh catalog as it runs, so the pull
 * it triggers is always stamped a second AFTER the audit that caused it. The
 * banner then never came down, refresh or not (production, 2026-09-05:
 * audit completed 06:22:35, last pull 06:22:36).
 *
 * The audit clause is not needed anyway: the worker now scores a catalog the
 * moment it lands, so the audit is `pending` or `running` within a tick and
 * the status line already has words for that.
 */
export function isCatalogArriving(input: CatalogArrivalInput): boolean {
  const c = input.connection;
  if (!c || c.status !== 'connected') return false;
  // A pull that failed is reported by the connection card. Claiming it is
  // still on its way would spin until the merchant gave up.
  if (c.pullPhase === 'failed') return false;
  if (c.pullRequestedAt != null) return true;
  if (c.pullPhase === 'running') return true;
  return c.lastPullAt == null;
}
