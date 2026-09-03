import type { PushPayload } from '../model/types';
import { purgeDeviceToken, touchDeviceToken } from './subscriptions';

/**
 * Firebase transport, for the apps published to the stores.
 *
 * Their WebView has no Push API — on iOS nothing else reaches the device — so
 * the shell registers a Firebase token and this sends to it. Dormant until the
 * service account is configured: without it, `deliverToDevices` reports zero
 * and the web channel carries on alone.
 *
 * Kept apart from `send.ts` so the web path never loads firebase-admin.
 */

type Messaging = {
  send(message: {
    token: string;
    notification: { title: string; body: string };
    data?: Record<string, string>;
    android?: Record<string, unknown>;
    apns?: Record<string, unknown>;
  }): Promise<string>;
};

let messaging: Messaging | null | undefined;

/** The three values a service account is made of, or nothing at all. */
function credentials(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Stored with escaped newlines, as every environment file does.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function isNativePushConfigured(): boolean {
  return credentials() !== null;
}

/** Lazily initialised: importing firebase-admin costs ~100ms we do not spend
 *  on a deployment that has no Firebase project. */
async function messagingClient(): Promise<Messaging | null> {
  if (messaging !== undefined) return messaging;
  const creds = credentials();
  if (!creds) {
    messaging = null;
    return null;
  }
  // v14 exposes the modular API: one app per process, reused across sends.
  const { cert, getApps, initializeApp } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');
  const app = getApps()[0] ?? initializeApp({ credential: cert(creds) });
  messaging = getMessaging(app) as unknown as Messaging;
  return messaging;
}

/**
 * Push to the installed apps of one account.
 *
 * @returns how many devices were actually reached.
 */
export async function sendNativePush(
  tokens: readonly string[],
  payload: PushPayload
): Promise<number> {
  if (tokens.length === 0) return 0;
  const client = await messagingClient();
  if (!client) return 0;

  let delivered = 0;
  await Promise.all(
    tokens.map(async (token) => {
      try {
        await client.send({
          token,
          notification: { title: payload.title, body: payload.body },
          // The tap destination travels as data: both platforms hand it to the
          // shell, which opens the screen the bell would.
          data: payload.url ? { url: payload.url } : undefined,
          android: {
            notification: {
              // Alpha-only silhouette, like the web badge: a coloured icon in
              // Android's status bar comes out as a white square.
              icon: 'ic_stat_notification',
              // Same tag rule as the browser: a second notice about the same
              // thing replaces the first.
              tag: payload.tag
            }
          },
          apns: { payload: { aps: { sound: 'default', 'thread-id': payload.tag } } }
        });
        delivered += 1;
        await touchDeviceToken(token);
      } catch (error) {
        const code = (error as { errorInfo?: { code?: string } }).errorInfo?.code ?? '';
        // The app was uninstalled, or the token was rotated: nothing else ever
        // tells us, and a dead token would be retried forever.
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument')
        ) {
          await purgeDeviceToken(token);
          return;
        }
        console.error('[push] firebase send failed', code, (error as Error).message);
      }
    })
  );
  return delivered;
}
