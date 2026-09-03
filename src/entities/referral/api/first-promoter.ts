import { REFERRAL_TTL_DAYS } from '../lib/ref';

/**
 * FirstPromoter, server side.
 *
 * We report the signup ourselves instead of loading their browser script: the
 * attribution then survives ad blockers, needs no third-party cookie, and can
 * be tested. The recurring commission itself is decided in their dashboard —
 * this only tells them which promoter a new account came from.
 *
 * Dormant without an API key, so a deployment that has no affiliate programme
 * carries no dead call.
 */

const ENDPOINT = 'https://firstpromoter.com/api/v1/track/signup';
const TIMEOUT_MS = 5000;

export function isReferralTrackingConfigured(): boolean {
  return Boolean(process.env.FIRSTPROMOTER_API_KEY);
}

export interface TrackSignupInput {
  /** Our own user id — also written on the Stripe customer as `fp_uid`, which
   *  is how their Stripe integration ties the subscription to this lead. */
  userId: string;
  email: string;
  /** The promoter's referral id, as their link carried it. */
  refId: string;
  /** Visitor address, for their fraud checks. Optional and never required. */
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
  if (!apiKey) return { ok: true, skipped: 'not_configured' };

  const body = new URLSearchParams({
    email: input.email,
    uid: input.userId,
    ref_id: input.refId,
    created_at: (input.createdAt ?? new Date()).toISOString()
  });
  if (input.ip) body.set('ip', input.ip);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
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
