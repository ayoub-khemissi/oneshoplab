import { getAnalyticsConsent } from '@/lib/consent';

/**
 * Fire a GA4 event — but only if the visitor granted analytics consent
 * AND gtag.js is actually loaded (the <Analytics> component injects it
 * lazily, post-consent only). Before consent `window.gtag` is undefined
 * so this is a hard no-op: no queueing, no leaks, GDPR-safe.
 *
 * Callers should not assume the event fired. For conversions that must
 * survive "visitor accepts cookies a few seconds after landing", use
 * the <TrackEvent> beacon which waits for the consent-change event.
 */
type GtagWindow = Window & {
  gtag?: (command: string, ...args: unknown[]) => void;
};

export function trackEvent(
  name: string,
  params?: Record<string, unknown>
): boolean {
  if (typeof window === 'undefined') return false;
  if (getAnalyticsConsent() !== 'granted') return false;
  const w = window as GtagWindow;
  if (typeof w.gtag !== 'function') return false;
  w.gtag('event', name, params ?? {});
  return true;
}
