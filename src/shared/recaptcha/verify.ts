/**
 * reCAPTCHA v2 server-side verifier. Same `siteverify` endpoint as v3
 * but the response carries no `score` field — just a `success` boolean
 * tied to the user actually solving the "I'm not a robot" challenge.
 *
 * Returns `{ ok: true }` silently when `RECAPTCHA_SECRET_KEY` isn't
 * configured (dev mode), so contributors can run the auth pages
 * locally without registering a key.
 */

interface SiteVerifyResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
}

export interface RecaptchaResult {
  ok: boolean;
  reason?: string;
}

export async function verifyRecaptcha(
  token: string | null | undefined,
  /** Kept in the signature for symmetry with v3 callers but unused on
   *  v2 — the widget doesn't tag actions. */
  _expectedAction?: string
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
      signal: AbortSignal.timeout(8000)
    });
    json = (await res.json()) as SiteVerifyResponse;
  } catch (e) {
    console.error('[recaptcha] siteverify network error', e);
    return { ok: false, reason: 'verify_failed' };
  }

  if (!json.success) {
    return {
      ok: false,
      reason: json['error-codes']?.join(',') ?? 'rejected'
    };
  }
  return { ok: true };
}

/** Whether the recaptcha wrapper should be rendered. Public — site key
 *  ships to the client; the secret stays server-only via verifyRecaptcha. */
export function isRecaptchaEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY);
}
