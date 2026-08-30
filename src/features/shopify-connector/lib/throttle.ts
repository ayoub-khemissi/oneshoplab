/**
 * Admin GraphQL is cost-based: every response carries
 * `extensions.cost.throttleStatus` (leaky bucket). We wait until the bucket
 * can afford the next call instead of hammering and getting THROTTLED.
 */
export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  /** Points restored per second. */
  restoreRate: number;
}

export interface CostExtension {
  requestedQueryCost: number;
  actualQueryCost: number | null;
  throttleStatus: ThrottleStatus;
}

/** Upper bound Shopify accepts for a single query; also our default estimate. */
export const MAX_SINGLE_QUERY_COST = 1000;

/** Milliseconds to wait before a request expected to cost `nextCost` points. */
export function throttleDelayMs(status: ThrottleStatus | null, nextCost: number): number {
  if (!status) return 0;
  const need = Math.min(nextCost, status.maximumAvailable);
  if (status.currentlyAvailable >= need) return 0;
  const rate = status.restoreRate > 0 ? status.restoreRate : 50;
  return Math.ceil(((need - status.currentlyAvailable) / rate) * 1000);
}

/** Bucket state after `elapsedMs` with no calls (so a stale status is not over-pessimistic). */
export function projectStatus(status: ThrottleStatus, elapsedMs: number): ThrottleStatus {
  const restored = (Math.max(0, elapsedMs) / 1000) * status.restoreRate;
  return {
    ...status,
    currentlyAvailable: Math.min(status.maximumAvailable, status.currentlyAvailable + restored)
  };
}
