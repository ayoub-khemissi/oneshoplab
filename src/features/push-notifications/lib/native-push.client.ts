/**
 * Push inside the app published to the stores.
 *
 * The shell loads the live site in a WebView, and a WebView has no Push API —
 * on iOS nothing else reaches the device at all. So when the page detects it is
 * running inside the shell, it asks the native layer instead: permission,
 * Firebase token, then the same account registration the browser does.
 *
 * Everything is imported lazily: a browser must never download the Capacitor
 * runtime for a shell it is not running in.
 */

import { registerFcmDeviceAction, unregisterFcmDeviceAction } from '../api/actions';

/** Where the shell's Firebase token is remembered on the device. */
export const NATIVE_TOKEN_KEY = 'osl.fcm-token';

/** Whether this installed app is already registered with the account. */
export function hasNativeToken(): boolean {
  try {
    return Boolean(window.localStorage.getItem(NATIVE_TOKEN_KEY));
  } catch {
    return false;
  }
}

/** Whether this page is running inside the native shell. */
export async function isNativeShell(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  // The shell injects this global before the page loads; no import, no cost.
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

/** Ask, register, and hand the token to the account. Resolves false when the
 *  person refuses — the caller says so in their own words. */
export async function registerNativePush(): Promise<boolean> {
  if (!(await isNativeShell())) return false;
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const current = await PushNotifications.checkPermissions();
  const granted =
    current.receive === 'granted' ? current : await PushNotifications.requestPermissions();
  if (granted.receive !== 'granted') return false;

  const token = await new Promise<string | null>((resolve) => {
    // `register()` answers through an event; a device that never answers must
    // not leave the caller hanging.
    const timeout = setTimeout(() => resolve(null), 15000);
    void PushNotifications.addListener('registration', (result) => {
      clearTimeout(timeout);
      resolve(result.value);
    });
    void PushNotifications.addListener('registrationError', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    void PushNotifications.register();
  });
  if (!token) return false;

  const res = await registerFcmDeviceAction(token, navigator.userAgent);
  if (res.ok) {
    // Kept so signing out can unregister exactly this device, and so the
    // settings switch knows the app is registered without asking Firebase.
    try {
      window.localStorage.setItem(NATIVE_TOKEN_KEY, token);
    } catch {
      // A device that cannot remember still receives; it just cannot be
      // unregistered from here.
    }
  }
  return res.ok;
}

/** Signing out of the app: the device stops receiving that account's notices. */
export async function unregisterNativePush(): Promise<void> {
  if (!(await isNativeShell())) return;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const delivered = await PushNotifications.getDeliveredNotifications();
  if (delivered.notifications.length > 0) {
    await PushNotifications.removeAllDeliveredNotifications();
  }
  const token = window.localStorage.getItem(NATIVE_TOKEN_KEY);
  if (token) {
    await unregisterFcmDeviceAction(token);
    window.localStorage.removeItem(NATIVE_TOKEN_KEY);
  }
}
