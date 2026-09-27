/**
 * When the next monthly credit refill is due. Credits are a monthly
 * allowance on every plan, but not every billing channel announces each
 * month: a Stripe yearly plan invoices once a year and Shopify sends no
 * per-cycle event at all. Those subscriptions carry `nextCreditRefillAt`,
 * and this is how it moves forward:
 *
 * - `monthly` on Shopify bills EVERY_30_DAYS, so the refill follows 30 days;
 * - `yearly` refills every calendar month on the same day, clamped to the
 *   month's length (31 January → 28/29 February → 31 March keeps the 31st
 *   as its anchor through `anchorDay`).
 */
export function nextRefill(
  from: Date,
  cycle: 'monthly' | 'yearly',
  anchorDay: number = from.getUTCDate()
): Date {
  if (cycle === 'monthly') return new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      m,
      Math.min(anchorDay, last),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds()
    )
  );
}
