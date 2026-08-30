import { getAnalyticsConsent } from './consent';

/**
 * Fire a Meta (Facebook) Pixel event — but only if the visitor granted
 * analytics consent AND fbevents.js is actually loaded (the <MetaPixel>
 * component injects it lazily, post-consent only). Before consent
 * `window.fbq` is undefined so this is a hard no-op: no queueing, no network,
 * GDPR-safe. This is the fbq twin of `trackEvent()` for GA4.
 *
 * Callers should not assume the event fired. For conversions that must
 * survive "visitor accepts cookies a few seconds after landing", use the
 * <MetaPixelEvent> beacon which waits for the consent-change event.
 */
type FbqWindow = Window & {
  fbq?: (command: string, ...args: unknown[]) => void;
};

export function trackMetaEvent(name: string, params?: Record<string, unknown>): boolean {
  if (typeof window === 'undefined') return false;
  if (getAnalyticsConsent() !== 'granted') return false;
  const w = window as FbqWindow;
  if (typeof w.fbq !== 'function') return false;
  w.fbq('track', name, params ?? {});
  return true;
}
