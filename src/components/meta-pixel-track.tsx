'use client';

import { useEffect } from 'react';
import { CONSENT_EVENT } from '@/lib/consent';
import { trackMetaEvent } from '@/lib/meta-pixel-event';

/**
 * Declarative Meta Pixel conversion beacon — the fbq twin of <TrackEvent>.
 * Drop it in a server component and it fires `event` once on mount. Robust to
 * the consent-after-landing case: if the visitor hasn't accepted analytics
 * yet, it waits for the consent-change event (and polls briefly, since
 * fbevents.js loads a tick after consent) then fires — so a conversion is
 * never lost just because the cookie banner was still open.
 *
 * `onceKey` dedupes via sessionStorage (per tab). The key is only marked
 * AFTER the event actually fires, so a pre-consent mount that no-ops can
 * still fire later once consent is granted.
 */
export function MetaPixelEvent({
  event,
  params,
  onceKey
}: {
  event: string;
  params?: Record<string, unknown>;
  onceKey?: string;
}) {
  useEffect(() => {
    const sk = onceKey ? `oneshoplab.fbev.${onceKey}` : null;
    const alreadyFired = () => {
      if (!sk) return false;
      try {
        return sessionStorage.getItem(sk) === '1';
      } catch {
        return false;
      }
    };
    if (alreadyFired()) return;

    let done = false;
    let tries = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (interval) clearInterval(interval);
      interval = null;
      window.removeEventListener(CONSENT_EVENT, attempt);
    };

    function attempt() {
      if (done) return;
      if (trackMetaEvent(event, params)) {
        done = true;
        if (sk) {
          try {
            sessionStorage.setItem(sk, '1');
          } catch {
            /* private mode — accept a possible double count */
          }
        }
        cleanup();
      }
    }

    attempt();
    if (done) return;

    // Not fired yet (no consent, or fbevents.js still loading). React to
    // consent changes and poll for up to ~12s for fbq to come online.
    window.addEventListener(CONSENT_EVENT, attempt);
    interval = setInterval(() => {
      tries += 1;
      attempt();
      if (done || tries >= 24) cleanup();
    }, 500);

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
