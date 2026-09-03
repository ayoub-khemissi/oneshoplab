/**
 * When the store next checks in, and whether the merchant may ask it to do so
 * now. Pure, so the countdown the page shows and the refusal the server gives
 * are the same rule read twice.
 */

/** The plugin's own cadence: it polls every five minutes (`CRON_POLL_CHANGES`). */
export const PLUGIN_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** How long a merchant must wait between two "sync now" — the ask travels to
 *  a store that is already checking on its own; more often is noise. */
export const SYNC_REQUEST_COOLDOWN_MS = 60 * 1000;

/** Milliseconds until the store's next scheduled check, or null when it has
 *  never called and there is nothing to count down to. */
export function msUntilNextCheck(
  lastSeenAtIso: string | null,
  now: number = Date.now()
): number | null {
  if (!lastSeenAtIso) return null;
  const last = new Date(lastSeenAtIso).getTime();
  if (Number.isNaN(last)) return null;
  const elapsed = now - last;
  // A store that has been silent for longer than a whole cycle is late, not
  // scheduled: there is no honest countdown to show.
  if (elapsed > PLUGIN_POLL_INTERVAL_MS * 3) return null;
  return Math.max(0, PLUGIN_POLL_INTERVAL_MS - (elapsed % PLUGIN_POLL_INTERVAL_MS));
}

/** Milliseconds left on the cooldown, 0 when the button is free again. */
export function cooldownRemainingMs(
  lastRequestedAtIso: string | null,
  now: number = Date.now()
): number {
  if (!lastRequestedAtIso) return 0;
  const last = new Date(lastRequestedAtIso).getTime();
  if (Number.isNaN(last)) return 0;
  return Math.max(0, SYNC_REQUEST_COOLDOWN_MS - (now - last));
}
