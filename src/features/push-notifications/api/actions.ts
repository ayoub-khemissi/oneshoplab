'use server';

import { z } from 'zod';
import { removeSubscription, saveSubscription } from '@/entities/push-subscription';
import { auth } from '@/entities/user';

const endpoint = z.string().url().max(512);

const deviceSchema = z.object({
  endpoint,
  p256dh: z.string().min(1).max(255),
  auth: z.string().min(1).max(255),
  userAgent: z.string().max(512).optional()
});

export type RegisterDeviceResult = { ok: true } | { ok: false; error: string };

/** This browser will receive the account's notifications. */
export async function registerDeviceAction(input: unknown): Promise<RegisterDeviceResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const parsed = deviceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'bad_request' };

  await saveSubscription({ userId: session.user.id, ...parsed.data });
  return { ok: true };
}

/** It will not any more — on the switch, and when signing out. */
export async function unregisterDeviceAction(rawEndpoint: string): Promise<RegisterDeviceResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const parsed = endpoint.safeParse(rawEndpoint);
  if (!parsed.success) return { ok: false, error: 'bad_request' };

  await removeSubscription(session.user.id, parsed.data);
  return { ok: true };
}
