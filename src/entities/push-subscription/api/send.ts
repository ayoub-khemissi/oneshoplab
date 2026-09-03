import webpush from 'web-push';
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

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

/**
 * Push to every device of a user. Subscriptions the service reports as gone
 * (404/410) are deleted on the spot: nothing else ever tells us a browser
 * profile was wiped, and a dead endpoint would be retried forever.
 *
 * @returns how many devices were actually reached.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  // Web push only: a Firebase device carries a token, not an endpoint, and is
  // delivered to by the native channel (see docs/ops/store-release.md).
  const devices = (await listSubscriptions(userId)).filter(
    (device): device is typeof device & { endpoint: string; p256dh: string; auth: string } =>
      device.channel === 'webpush' &&
      Boolean(device.endpoint) &&
      Boolean(device.p256dh) &&
      Boolean(device.auth)
  );
  if (devices.length === 0) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;
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
