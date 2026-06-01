import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless opt-out tokens. We HMAC the lead id with a server secret —
 * no DB column to store, no token table to GC. Verification is constant
 * time (timingSafeEqual) so a leaked token can't be brute-forced from
 * timing differences.
 *
 * The token is what we put in the public unsubscribe URL:
 *   https://get-oneshoplab.com/unsubscribe?t=<token>
 * The handler decodes <token>, recovers the leadId, and flips
 * leads.status to 'dead'.
 */

function secret(): string {
  const s = process.env.COLD_OPTOUT_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'COLD_OPTOUT_SECRET missing or too short — set a 32-byte random hex string in .env'
    );
  }
  return s;
}

export function makeOptOutToken(leadId: string): string {
  const sig = createHmac('sha256', secret()).update(leadId).digest('base64url').slice(0, 22);
  return `${leadId}.${sig}`;
}

/** Returns leadId on success, null on tampering / wrong format. */
export function verifyOptOutToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const leadId = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  const expected = createHmac('sha256', secret())
    .update(leadId)
    .digest('base64url')
    .slice(0, 22);
  if (presented.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(presented), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return leadId;
}
