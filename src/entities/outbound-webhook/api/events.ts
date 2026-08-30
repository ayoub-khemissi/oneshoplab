import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/shared/db';
import { outboundWebhooks, webhookDeliveries, type WebhookEvent } from '@/shared/db/schema';
import { ulid } from '@/shared/lib';
import { floorToSecond } from '../lib/backoff';
import type { EmitResult } from '../model/types';

/**
 * Fan an event out to every enabled webhook of the project subscribed to
 * it: one pending delivery per webhook, sharing `eventId`. Best effort by
 * contract — a webhook outage must never fail the approval / sync that
 * raised the event, so failures are logged and an empty result returned.
 */
export async function emitProjectEvent(
  projectId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  at: Date = new Date()
): Promise<EmitResult> {
  const eventId = ulid();
  const now = floorToSecond(at);
  try {
    const hooks = await db
      .select({ id: outboundWebhooks.id, events: outboundWebhooks.events })
      .from(outboundWebhooks)
      .where(
        and(
          eq(outboundWebhooks.projectId, projectId),
          eq(outboundWebhooks.enabled, true),
          isNull(outboundWebhooks.disabledAt)
        )
      );
    const targets = hooks.filter((h) => h.events.includes(event));
    if (targets.length === 0) return { eventId, deliveryIds: [] };
    const rows = targets.map((h) => ({
      id: ulid(),
      webhookId: h.id,
      eventId,
      event,
      payload: data,
      attempt: 0,
      status: 'pending' as const,
      nextAttemptAt: now,
      createdAt: now
    }));
    await db.insert(webhookDeliveries).values(rows);
    return { eventId, deliveryIds: rows.map((r) => r.id) };
  } catch (e) {
    console.error('[outbound-webhook] emit failed', event, e);
    return { eventId, deliveryIds: [] };
  }
}

/** "Send a test event": one `ping` delivery to a single webhook, even a disabled one. */
export async function enqueuePing(webhookId: string, at: Date = new Date()): Promise<string> {
  const id = ulid();
  const now = floorToSecond(at);
  await db.insert(webhookDeliveries).values({
    id,
    webhookId,
    eventId: ulid(),
    event: 'ping',
    payload: { webhookId, sentAt: now.toISOString() },
    attempt: 0,
    status: 'pending',
    nextAttemptAt: now,
    createdAt: now
  });
  return id;
}
