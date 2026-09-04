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
  /** The audit the dashboard is about to render. */
  audit: { status: string; createdAt: Date } | null;
}

/**
 * True while the merchant should be told the catalog is on its way rather than
 * shown the state of an audit that predates it.
 *
 * Three ways to be in that window, in the order they happen: a pull is queued,
 * a pull is running, or a pull finished and no audit has scored it yet. The
 * last one is what the two-minute gap was made of.
 */
export function isCatalogArriving(input: CatalogArrivalInput): boolean {
  const c = input.connection;
  if (!c || c.status !== 'connected') return false;
  if (c.pullRequestedAt != null) return true;
  if (c.pullPhase === 'running') return true;
  if (c.lastPullAt == null) return true;

  // A completed audit that already covers this catalog ends the window; any
  // other audit (failed, or older than the catalog) does not describe it.
  const a = input.audit;
  if (!a) return true;
  if (a.status !== 'completed') return true;
  return a.createdAt < c.lastPullAt;
}
