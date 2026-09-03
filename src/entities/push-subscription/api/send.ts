import webpush from 'web-push';
import { isNativePushConfigured, sendNativePush } from './send-native';
import { listSubscriptions, purgeSubscription, touchSubscription } from './subscriptions';
import type { PushPayload } from '../model/types';

/**
 * Web Push transport.
 *
 * It only delivers: what to say and to whom is decided by `notify()` in
 * entities/notification. Sending is best-effort by contract — a push that
 * fails must never fail the request that triggered it, because the notice is
 * already in the bell.
 */

let configured: boolean | null = null;

/** VAPID identifies us to the push services; without a pair there is no push. */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:contact@oneshoplab.com';
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/** Either channel being configured is enough to have something to send with. */
export function isPushConfigured(): boolean {
  return ensureConfigured() || isNativePushConfigured();
}

/**
 * Push to every device of a user. Subscriptions the service reports as gone
 * (404/410) are deleted on the spot: nothing else ever tells us a browser
 * profile was wiped, and a dead endpoint would be retried forever.
 *
 * @returns how many devices were actually reached.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const all = await listSubscriptions(userId);
  if (all.length === 0) return 0;

  // The same person may hold both: a browser on the laptop and the app from a
  // store on the phone. Each channel delivers to its own rows.
  const tokens = all
    .filter((device) => device.channel === 'fcm' && device.deviceToken)
    .map((device) => device.deviceToken as string);
  const nativeDelivered = await sendNativePush(tokens, payload);

  if (!ensureConfigured()) return nativeDelivered;
  const devices = all.filter(
    (device): device is typeof device & { endpoint: string; p256dh: string; auth: string } =>
      device.channel === 'webpush' &&
      Boolean(device.endpoint) &&
      Boolean(device.p256dh) &&
      Boolean(device.auth)
  );
  if (devices.length === 0) return nativeDelivered;

  const body = JSON.stringify(payload);
  let delivered = nativeDelivered;
  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth }
          },
          body,
          { TTL: 60 * 60 * 24 }
        );
        delivered += 1;
        await touchSubscription(device.endpoint);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await purgeSubscription(device.endpoint);
          return;
        }
        console.error('[push] send failed', status ?? '', (error as Error).message);
      }
    })
  );
  return delivered;
}
