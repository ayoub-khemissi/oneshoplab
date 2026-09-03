'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  isIosBrowserWithoutPush,
  isWebPushAvailable,
  subscribeToWebPush,
  unsubscribeFromWebPush
} from '../lib/web-push.client';

/**
 * Where this device stands with push.
 *
 * - `unavailable`: no push here (browser, or no key configured).
 * - `ios_install`: Safari on iPhone/iPad — push only once added to the home screen.
 * - `loading`: not read yet.
 * - `prompt`: the browser has not been asked; asking is one tap away.
 * - `denied`: refused in the browser; only its settings can undo that.
 * - `off`: allowed by the browser, but this device is not registered.
 * - `on`: this device receives the account's notifications.
 */
export type PushStatus =
  'unavailable' | 'ios_install' | 'loading' | 'prompt' | 'denied' | 'off' | 'on';

/**
 * Set when the merchant turned push off themselves, so a later visit does not
 * quietly register the device again — an "off" that comes back on is not off.
 */
const DISABLED_KEY = 'osl.push-disabled';

/** How long `serviceWorker.ready` may take before push is given up on here. */
const READY_TIMEOUT_MS = 8000;

export function readPushDisabled(): boolean {
  try {
    return window.localStorage.getItem(DISABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function writePushDisabled(disabled: boolean) {
  try {
    if (disabled) window.localStorage.setItem(DISABLED_KEY, '1');
    else window.localStorage.removeItem(DISABLED_KEY);
  } catch {
    // Not remembering is acceptable: the switch still worked for this visit.
  }
}

async function readSubscription(): Promise<PushSubscription | null> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('service worker not ready')), READY_TIMEOUT_MS)
  );
  const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);
  return registration.pushManager.getSubscription();
}

/** Where this device stands right now, as the browser tells it. */
async function readStatus(): Promise<PushStatus> {
  if (!isWebPushAvailable()) {
    return isIosBrowserWithoutPush() ? 'ios_install' : 'unavailable';
  }
  if (Notification.permission === 'denied') return 'denied';
  try {
    const subscription = await readSubscription();
    if (subscription) return 'on';
    return Notification.permission === 'granted' ? 'off' : 'prompt';
  } catch {
    return 'unavailable';
  }
}

/**
 * This device's registration, and the two things that change it. `enable` asks
 * the browser (which shows its own prompt the first time) and registers the
 * device with the account; `disable` unregisters it and remembers the choice.
 */
export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>('loading');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    setIsBusy(true);
    try {
      await subscribeToWebPush();
      writePushDisabled(false);
      setStatus('on');
      return true;
    } catch {
      // Refused at the browser's prompt, or the registration failed: the
      // browser's own state says which.
      setStatus(Notification.permission === 'denied' ? 'denied' : 'prompt');
      return false;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<boolean> => {
    setIsBusy(true);
    try {
      await unsubscribeFromWebPush();
      writePushDisabled(true);
      setStatus('off');
      return true;
    } catch {
      return false;
    } finally {
      setIsBusy(false);
    }
  }, []);

  return { status, isBusy, enable, disable };
}
