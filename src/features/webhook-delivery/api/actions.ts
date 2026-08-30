'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  MAX_DELIVERIES_PAGE,
  MAX_WEBHOOK_URL_LENGTH,
  createManualWebhook,
  deleteWebhook,
  enqueuePing,
  getWebhook,
  listDeliveries,
  listWebhooks,
  webhookEventsSchema,
  type OutboundWebhookView,
  type WebhookDeliveryView,
  type WebhookUrlRejection
} from '@/entities/outbound-webhook';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';

const uuid = z.string().uuid();
const createSchema = z.object({
  projectId: uuid,
  url: z.string().trim().min(1).max(MAX_WEBHOOK_URL_LENGTH),
  events: webhookEventsSchema.optional()
});

export type WebhookActionError =
  'unauthorized' | 'bad_request' | 'not_found' | 'sealing_unavailable' | WebhookUrlRejection;

type Result<T> = { ok: true; value: T } | { ok: false; error: WebhookActionError };

async function ownedProjectId(projectId: unknown): Promise<Result<string>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const id = uuid.safeParse(projectId);
  if (!id.success) return { ok: false, error: 'bad_request' };
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id.data), eq(projects.userId, session.user.id)));
  return row ? { ok: true, value: row.id } : { ok: false, error: 'not_found' };
}

export async function listWebhooksAction(
  projectId: string
): Promise<Result<OutboundWebhookView[]>> {
  const owned = await ownedProjectId(projectId);
  if (!owned.ok) return owned;
  return { ok: true, value: await listWebhooks(owned.value) };
}

export async function listDeliveriesAction(
  projectId: string,
  limit = 20
): Promise<Result<WebhookDeliveryView[]>> {
  const owned = await ownedProjectId(projectId);
  if (!owned.ok) return owned;
  const take = z.number().int().min(1).max(MAX_DELIVERIES_PAGE).safeParse(limit);
  if (!take.success) return { ok: false, error: 'bad_request' };
  return { ok: true, value: await listDeliveries(owned.value, take.data) };
}

/** "Other integration" webhook: returns the secret exactly once. */
export async function createManualWebhookAction(input: {
  projectId: string;
  url: string;
  events?: string[];
}): Promise<Result<{ id: string; secret: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'bad_request' };
  const owned = await ownedProjectId(parsed.data.projectId);
  if (!owned.ok) return owned;
  const session = await auth();
  const res = await createManualWebhook(owned.value, {
    url: parsed.data.url,
    events: parsed.data.events,
    createdBy: session?.user?.id ?? null
  });
  if (!res.ok) return { ok: false, error: res.reason };
  revalidatePath(`/dashboard/sites/${owned.value}`);
  return { ok: true, value: { id: res.id, secret: res.secret } };
}

export async function deleteWebhookAction(
  projectId: string,
  webhookId: string
): Promise<Result<true>> {
  const owned = await ownedProjectId(projectId);
  if (!owned.ok) return owned;
  const id = uuid.safeParse(webhookId);
  if (!id.success) return { ok: false, error: 'bad_request' };
  const deleted = await deleteWebhook(owned.value, id.data);
  if (!deleted) return { ok: false, error: 'not_found' };
  revalidatePath(`/dashboard/sites/${owned.value}`);
  return { ok: true, value: true };
}

/** "Send a test event": the worker picks the ping up on its next tick (≤ 5 s). */
export async function sendPingAction(
  projectId: string,
  webhookId: string
): Promise<Result<{ deliveryId: string }>> {
  const owned = await ownedProjectId(projectId);
  if (!owned.ok) return owned;
  const id = uuid.safeParse(webhookId);
  if (!id.success) return { ok: false, error: 'bad_request' };
  const hook = await getWebhook(owned.value, id.data);
  if (!hook.ok) return { ok: false, error: 'not_found' };
  return { ok: true, value: { deliveryId: await enqueuePing(hook.value.id) } };
}
