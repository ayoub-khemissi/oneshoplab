/**
 * reCAPTCHA v3 server-side verifier. Calls Google's siteverify endpoint
 * and applies the score threshold + action match. Returns `{ ok: true }`
 * silently when no `RECAPTCHA_SECRET_KEY` is configured (dev mode), so
 * features that wrap their forms with the client component still work
 * locally without forcing every contributor to register a key.
 */

interface SiteVerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
}

export interface RecaptchaResult {
  ok: boolean;
  score?: number;
  reason?: string;
}

/** Tokens scoring below this are treated as bots. Google's docs suggest
 *  0.5 as the default threshold for low-risk pages and adjusting upwards
 *  on sensitive flows. Signup is the lone wrap-point for now, so we
 *  keep it permissive — if abuse rises, bump to 0.7. */
const SCORE_THRESHOLD = 0.5;

export async function verifyRecaptcha(
  token: string | null | undefined,
  expectedAction: string
): Promise<RecaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return { ok: true, reason: 'unconfigured' };
  if (!token || token.length < 20) return { ok: false, reason: 'missing_token' };

  let json: SiteVerifyResponse;
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }).toString(),
      // Don't hang the form submit forever if Google is slow.
      signal: AbortSignal.timeout(8000)
    });
    json = (await res.json()) as SiteVerifyResponse;
  } catch (e) {
    // Network blip — fail closed so a transient outage doesn't open
    // the door, but log so we can spot a Google-side issue.
    console.error('[recaptcha] siteverify network error', e);
    return { ok: false, reason: 'verify_failed' };
  }

  if (!json.success) {
    return { ok: false, reason: 'rejected', score: json.score };
  }
  if (json.action && json.action !== expectedAction) {
    return { ok: false, reason: 'action_mismatch', score: json.score };
  }
  if (typeof json.score === 'number' && json.score < SCORE_THRESHOLD) {
    return { ok: false, reason: 'low_score', score: json.score };
  }
  return { ok: true, score: json.score };
}

/** Whether the recaptcha wrapper should be rendered. Public — site key
 *  ships to the client; the secret stays server-only via verifyRecaptcha. */
export function isRecaptchaEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY
  );
}
