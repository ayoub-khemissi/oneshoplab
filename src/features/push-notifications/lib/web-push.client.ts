/**
 * Web Push, browser side. Runs only in a browser (touches `navigator`,
 * `window`, `Notification`), and talks to the account through the two server
 * actions of this slice.
 */

import { registerDeviceAction, unregisterDeviceAction } from '../api/actions';

/** The VAPID public key, as the build exposed it to the client. */
function publicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
}

/** Decode the URL-safe base64 key into what `PushManager` expects. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** Whether this browser has the stack at all. */
export function isWebPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Whether push can be offered here: the stack, and a key to sign with. */
export function isWebPushAvailable(): boolean {
  return isWebPushSupported() && publicKey().length > 0;
}

/**
 * Safari on iPhone and iPad only pushes to an app added to the home screen; in
 * the browser itself the stack is simply absent. Worth saying how to install
 * rather than hiding the feature.
 */
export function isIosBrowserWithoutPush(): boolean {
  if (typeof navigator === 'undefined' || isWebPushSupported()) return false;
  const isIos =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

/** Ask the browser, subscribe, and register the device with the account. */
export async function subscribeToWebPush(): Promise<void> {
  if (!isWebPushAvailable()) throw new Error('web push unavailable');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('permission not granted');

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey())
    }));

  const keys = subscription.toJSON().keys ?? {};
  const res = await registerDeviceAction({
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh ?? '',
    auth: keys.auth ?? '',
    userAgent: navigator.userAgent
  });
  if (!res.ok) throw new Error(res.error);
}

/** Unregister the device with the account, then tear the subscription down. */
export async function unsubscribeFromWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await unregisterDeviceAction(subscription.endpoint);
  await subscription.unsubscribe();
}
