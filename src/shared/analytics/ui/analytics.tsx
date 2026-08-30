'use client';

import { useEffect, useState } from 'react';
import { CONSENT_EVENT, getAnalyticsConsent } from '../consent';

/**
 * GA4 loader, consent-gated. Renders nothing — and injects nothing —
 * unless BOTH a measurement id is configured AND the visitor explicitly
 * granted analytics consent. Listens for the consent-change event so it
 * starts tracking the moment the visitor accepts, without a reload.
 *
 * IP anonymization + ad-personalization signals disabled to keep this
 * proportionate to a usage-measurement purpose (per the SEO addendum §5
 * decision rule: signups by locale/country, not ad retargeting).
 */
export function Analytics({ measurementId }: { measurementId?: string }) {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    if (!measurementId) return;
    const sync = () => setGranted(getAnalyticsConsent() === 'granted');
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    // Cross-tab: consent set in another tab should propagate here too.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [measurementId]);

  useEffect(() => {
    if (!measurementId || !granted) return;
    if (document.querySelector('script[data-ga4]')) return;

    const s = document.createElement('script');
    s.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    s.async = true;
    s.dataset.ga4 = '1';
    document.head.appendChild(s);

    const w = window as unknown as { dataLayer: unknown[]; gtag?: (...a: unknown[]) => void };
    w.dataLayer = w.dataLayer || [];
    function gtag(...args: unknown[]) {
      w.dataLayer.push(args);
    }
    w.gtag = gtag;
    gtag('js', new Date());
    gtag('config', measurementId, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
  }, [measurementId, granted]);

  return null;
}
