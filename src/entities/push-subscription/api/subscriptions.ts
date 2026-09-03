import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/shared/db';
import { pushSubscriptions } from '@/shared/db/schema';
import type { SaveSubscriptionInput } from '../model/types';

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/**
 * Register a device, or re-register it.
 *
 * The endpoint is the identity: a browser that already subscribed hands back
 * the same one, and the same device may well have been registered under
 * another account before (a shared laptop, an account switch). So this claims
 * the row for the current user rather than refusing it.
 */
export async function saveSubscription(input: SaveSubscriptionInput): Promise<void> {
  const now = new Date();
  await db
    .insert(pushSubscriptions)
    .values({
      id: randomUUID(),
      userId: input.userId,
      channel: 'webpush',
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      lastSeenAt: now
    })
    .onDuplicateKeyUpdate({
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        lastSeenAt: now
      }
    });
}

/** Unregister one device of one account (the switch, and signing out). */
export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/** Every device of an account. */
export async function listSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

/** A push service said the endpoint is gone: it never comes back. */
export async function purgeSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/** Bumped after a successful send — a device that stops answering shows here. */
export async function touchSubscription(endpoint: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastSeenAt: new Date() })
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

/** Register (or re-register) an installed app's Firebase token. */
export async function saveDeviceToken(input: {
  userId: string;
  deviceToken: string;
  userAgent?: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(pushSubscriptions)
    .values({
      id: randomUUID(),
      userId: input.userId,
      channel: 'fcm',
      deviceToken: input.deviceToken,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      lastSeenAt: now
    })
    .onDuplicateKeyUpdate({
      set: {
        userId: input.userId,
        channel: 'fcm',
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        lastSeenAt: now
      }
    });
}

/** Unregister one installed app of one account. */
export async function removeDeviceToken(userId: string, token: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.deviceToken, token)));
}

/** Firebase reported the token as gone: it never comes back. */
export async function purgeDeviceToken(token: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.deviceToken, token));
}

/** Bumped after a successful native send. */
export async function touchDeviceToken(token: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastSeenAt: new Date() })
    .where(eq(pushSubscriptions.deviceToken, token));
}
