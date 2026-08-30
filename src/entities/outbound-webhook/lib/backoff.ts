/** Retry schedule (spec → Delivery): 1 min, 5, 30, 2 h, 12 h, then `dead`. */
export const BACKOFF_SCHEDULE_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
export const MAX_DELIVERY_ATTEMPTS = BACKOFF_SCHEDULE_MS.length;
/** Auto-disable thresholds: consecutive failures / duration of the streak. */
export const DISABLE_AFTER_FAILURES = 50;
export const DISABLE_AFTER_FAILING_MS = 7 * 24 * 60 * 60 * 1000;
export const DELIVERY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** MySQL TIMESTAMP rounds sub-second values UP: a row scheduled "now" would
 *  not be due until the next second. Every stored schedule is floored. */
export function floorToSecond(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 1000) * 1000);
}

/** Delay before the retry following failed attempt number `attempt` (1-based); null = give up. */
export function backoffDelayMs(attempt: number): number | null {
  if (attempt < 1 || attempt >= MAX_DELIVERY_ATTEMPTS) return null;
  return BACKOFF_SCHEDULE_MS[attempt - 1];
}

export function shouldDisable(
  failureStreak: number,
  failingSince: Date | null,
  now: Date
): boolean {
  if (failureStreak >= DISABLE_AFTER_FAILURES) return true;
  return (
    failingSince !== null && now.getTime() - failingSince.getTime() >= DISABLE_AFTER_FAILING_MS
  );
}
