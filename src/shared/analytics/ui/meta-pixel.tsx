'use client';

import { useEffect, useState } from 'react';
import { CONSENT_EVENT, getAnalyticsConsent } from '../consent';

type FbqStub = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: unknown;
  loaded: boolean;
  version: string;
};
type FbqWindow = Window & { fbq?: FbqStub; _fbq?: FbqStub };

/**
 * Meta (Facebook) Pixel loader, consent-gated — the fbq twin of <Analytics>.
 * Renders nothing, and injects nothing, unless BOTH a pixel id is configured
 * AND the visitor explicitly granted analytics consent in the cookie banner.
 * Listens for the consent-change event so it starts the moment the visitor
 * accepts, without a reload.
 *
 * Because fbevents.js is only ever loaded post-consent, there is no
 * pre-consent queueing or network call — GDPR-safe by construction, exactly
 * like the GA4 loader. A `PageView` is sent on init; conversions go through
 * `trackMetaEvent` / <MetaPixelEvent>.
 */
export function MetaPixel({ pixelId }: { pixelId?: string }) {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    if (!pixelId) return;
    const sync = () => setGranted(getAnalyticsConsent() === 'granted');
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    // Cross-tab: consent set in another tab should propagate here too.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [pixelId]);

  useEffect(() => {
    if (!pixelId || !granted) return;
    if (document.querySelector('script[data-meta-pixel]')) return;

    const w = window as FbqWindow;
    // Standard Meta pixel bootstrap, typed (no `any`): set up the fbq queue,
    // then load fbevents.js which swaps in the real implementation and flushes.
    if (!w.fbq) {
      const fbq = function (...args: unknown[]) {
        if (fbq.callMethod) fbq.callMethod(...args);
        else fbq.queue.push(args);
      } as FbqStub;
      fbq.queue = [];
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      w.fbq = fbq;
      if (!w._fbq) w._fbq = fbq;
    }

    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    s.dataset.metaPixel = '1';
    document.head.appendChild(s);

    w.fbq('init', pixelId);
    w.fbq('track', 'PageView');
  }, [pixelId, granted]);

  return null;
}
