/**
 * Affiliate attribution, first-party.
 *
 * An influencer's link carries their referral id — `?fpr=<id>`, FirstPromoter's
 * own parameter, plus `?ref=` and `?via=` which the rest of the industry uses.
 * We keep it in a cookie of our own and report the signup from the server,
 * rather than loading the network's script: no third-party cookie, nothing for
 * an ad blocker to eat, and the attribution survives a visitor who signs up two
 * weeks later on another page.
 */

/** Query parameters an affiliate link may carry, in the order we trust them. */
export const REFERRAL_PARAMS = ['fpr', 'ref', 'via'] as const;

/** First-party cookie holding the referral id until the visitor signs up. */
export const REFERRAL_COOKIE = 'osl_ref';

/** How long a click is worth: the industry standard, and FirstPromoter's own. */
export const REFERRAL_TTL_DAYS = 90;

/**
 * A referral id is a public handle, not free text: keep it to what a promoter
 * link can legitimately carry so nothing else rides into a header or a payload.
 */
export function normalizeRefId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 64) return null;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

/** The referral id an incoming URL carries, if any. */
export function refFromSearchParams(params: URLSearchParams): string | null {
  for (const key of REFERRAL_PARAMS) {
    const found = normalizeRefId(params.get(key));
    if (found) return found;
  }
  return null;
}
