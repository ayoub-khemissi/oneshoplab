/**
 * Bulk catalog generation — Scale plan only. Public entry point; the
 * implementation is split across the sibling modules:
 *
 *   model/types.ts     — payload/result shapes, prefs resolution, readResult
 *   lib/context.ts     — audit-summary product shapes + prompt builders
 *   api/planning.ts    — cost estimate, candidates, "already generated" detection
 *   api/lifecycle.ts   — start / retry / cancel
 *   api/worker.ts      — per-product worker tick + stall watchdog
 *   api/progress.ts    — result persistence, terminal flips, notifications
 *   api/status.ts      — progress accessors for the UI
 *
 * Lifecycle:
 *
 *   1. startBulkSiteGenerate(): inserts the parent job (kind=
 *      bulk_site_generate) inside a DB transaction so a double-click
 *      can't insert two rows for the same site.
 *
 *   2. processNextBulkProduct() ticks once per worker iteration,
 *      FIFO-draining the oldest pending/running bulk. Each tick:
 *        - re-checks the parent's status (cancellation can land between
 *          ticks; we bail mid-product gracefully if status flipped)
 *        - finds the next product whose perProduct entry isn't fully
 *          terminal yet
 *        - runs each chat field (title/desc/tags) and the image fan-out
 *          INDEPENDENTLY: a single field that errors marks ONLY that
 *          field as failed; other fields still try, so a partial
 *          product is recorded as such. This is the "atomic" failure
 *          granularity — one field per product, not the whole chain.
 *        - persists per-field outcome on the parent's `result.perProduct`
 *          BEFORE moving to the next field, so a worker crash mid-
 *          product picks up where it left off without re-running (and
 *          re-billing) work that already succeeded.
 *
 *   3. cancelBulkJob() flips a non-terminal job to status='failed' with
 *      error='cancelled_by_user'. The next tick's status guard skips
 *      it; in-flight work in the current tick finishes and persists
 *      whatever it had time to do.
 *
 *   4. runBulkWatchdog() is invoked from the worker tick alongside the
 *      kie watchdog. Any bulk in 'running' that hasn't touched its
 *      result in BULK_STALL_TIMEOUT_MS gets force-failed.
 */

export {
  BULK_STALL_TIMEOUT_MS,
  pickBulkPrefs,
  resolveBulkPrefs,
  type BulkFieldKey,
  type BulkFieldOutcome,
  type BulkImageAngle,
  type BulkInputPayload,
  type BulkProductState,
  type BulkResult,
  type ResolvedBulkPrefs
} from './model/types';
export {
  estimateBulkCost,
  estimateBulkCostBreakdown,
  getEffectiveBulkPrefs,
  listBulkCandidates,
  listBulkCandidatesWithStatus,
  type BulkCandidate,
  type BulkCostBreakdown
} from './api/planning';
export { cancelBulkJob, retryFailedFromBulk, startBulkSiteGenerate } from './api/lifecycle';
export { processNextBulkProduct, runBulkWatchdog } from './api/worker';
export { getActiveBulkJob, getLatestBulkJobDetail, type BulkJobStatusForUi } from './api/status';
export { updateUserDefaultBulkPrefsAction } from './api/prefs-actions';
