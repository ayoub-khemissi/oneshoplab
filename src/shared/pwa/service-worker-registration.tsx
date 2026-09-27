'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker once the page is quiet.
 *
 * It is what makes the app installable and, more importantly, what receives
 * push notifications — a browser cannot subscribe without one. Registration is
 * deferred to `load` so it never competes with the first paint. A new worker
 * takes over by itself (`skipWaiting` in public/sw.js).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        // A failed registration costs the app nothing but push and offline —
        // never a broken page.
        console.warn('[pwa] service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
