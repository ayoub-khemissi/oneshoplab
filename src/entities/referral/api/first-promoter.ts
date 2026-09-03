import { REFERRAL_TTL_DAYS } from '../lib/ref';

/**
 * FirstPromoter, server side (tracking API v2).
 *
 * We report the signup ourselves instead of loading their browser script: the
 * attribution then survives ad blockers, needs no third-party cookie, and can
 * be tested. The recurring commission itself is decided in their dashboard —
 * this only tells them which promoter a new account came from.
 *
 * Dormant without an API key, so a deployment that has no affiliate programme
 * carries no dead call.
 */

const ENDPOINT = 'https://api.firstpromoter.com/api/v2/track/signup';
const TIMEOUT_MS = 5000;

export function isReferralTrackingConfigured(): boolean {
  return Boolean(process.env.FIRSTPROMOTER_API_KEY && process.env.FIRSTPROMOTER_ACCOUNT_ID);
}

export interface TrackSignupInput {
  /** Our own user id — also written on the Stripe customer as `fp_uid`, which
   *  is how their Stripe integration ties the subscription to this lead. */
  userId: string;
  email: string;
  /** The promoter's referral id, as their link carried it (`?fpr=…`). */
  refId: string;
  /** Kept for callers; the v2 tracking endpoint takes no address. */
  ip?: string | null;
  createdAt?: Date;
}

export type TrackSignupResult =
  { ok: true; skipped?: 'not_configured' } | { ok: false; status: number | null; message: string };

/**
 * Report one signup as referred.
 *
 * Best-effort by contract: an affiliate network being down must never cost
 * someone their account. The caller does not await it.
 */
export async function trackReferralSignup(input: TrackSignupInput): Promise<TrackSignupResult> {
  const apiKey = process.env.FIRSTPROMOTER_API_KEY;
  const accountId = process.env.FIRSTPROMOTER_ACCOUNT_ID;
  if (!apiKey || !accountId) return { ok: true, skipped: 'not_configured' };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Account-ID': accountId,
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email: input.email,
        uid: input.userId,
        ref_id: input.refId,
        // The promoter is told by their dashboard; the merchant gets our own
        // welcome, not a second e-mail from a network they never heard of.
        skip_email_notification: true
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) {
      const message = (await res.text().catch(() => '')).slice(0, 200);
      console.error('[referral] signup not tracked', res.status, message);
      return { ok: false, status: res.status, message };
    }
    return { ok: true };
  } catch (error) {
    console.error('[referral] signup not tracked', (error as Error).message);
    return { ok: false, status: null, message: (error as Error).message };
  }
}

/** Cookie lifetime, in seconds — the window a promoter's click is worth. */
export const REFERRAL_COOKIE_MAX_AGE = REFERRAL_TTL_DAYS * 24 * 60 * 60;
