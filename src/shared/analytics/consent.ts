/**
 * Minimal analytics-consent store (client-side). Not a full CMP — one
 * purpose (analytics), opt-in, persisted in localStorage. This is the
 * "grow the cookie banner into a real consent flow" step the original
 * CookieBanner comment anticipated, kept deliberately small.
 *
 * GDPR posture: default is `unset` → treated as NO analytics until the
 * visitor explicitly accepts. Never opt-out.
 */
export type AnalyticsConsent = 'granted' | 'denied' | 'unset';

const KEY = 'oneshoplab.consent.v1';
/** Fired on the window whenever consent changes so a mounted <Analytics>
 *  can react without a reload. */
export const CONSENT_EVENT = 'oneshoplab:consent-change';

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') return 'unset';
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : 'unset';
  } catch {
    return 'unset';
  }
}

export function setAnalyticsConsent(value: 'granted' | 'denied'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* private-mode quota — fall through, consent stays session-only */
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}
