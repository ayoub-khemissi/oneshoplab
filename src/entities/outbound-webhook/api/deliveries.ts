/**
 * Delivery state machine. `pending`/`failed` rows whose `nextAttemptAt` is
 * due are claimed by the worker; an outcome moves them to `delivered`,
 * back to `failed` with the next slot of the backoff schedule, or `dead`.
 * The webhook row keeps the streak that drives auto-disable.
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/shared/db';
import { outboundWebhooks, webhookDeliveries } from '@/shared/db/schema';
import { backoffDelayMs, floorToSecond, shouldDisable } from '../lib/backoff';
import type {
  DeliveryOutcome,
  OutboundWebhookRow,
  RecordOutcomeResult,
  WebhookDeliveryRow
} from '../model/types';

export const RESPONSE_BODY_MAX_BYTES = 1024;

export interface DueDelivery {
  delivery: WebhookDeliveryRow;
  webhook: OutboundWebhookRow;
}

/** Oldest due first; deliveries of a disabled webhook are marked dead on the way. */
export async function claimDueDeliveries(
  limit: number,
  now: Date = new Date()
): Promise<DueDelivery[]> {
  const rows = await db
    .select({ delivery: webhookDeliveries, webhook: outboundWebhooks })
    .from(webhookDeliveries)
    .innerJoin(outboundWebhooks, eq(outboundWebhooks.id, webhookDeliveries.webhookId))
    .where(
      and(
        inArray(webhookDeliveries.status, ['pending', 'failed']),
        or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, now))
      )
    )
    .orderBy(asc(webhookDeliveries.id))
    .limit(limit);
  const dead = rows.filter(
    (r) => r.delivery.event !== 'ping' && (!r.webhook.enabled || r.webhook.disabledAt !== null)
  );
  if (dead.length) {
    await db
      .update(webhookDeliveries)
      .set({ status: 'dead', responseBody: 'webhook_disabled', nextAttemptAt: null })
      .where(
        inArray(
          webhookDeliveries.id,
          dead.map((r) => r.delivery.id)
        )
      );
  }
  const deadIds = new Set(dead.map((r) => r.delivery.id));
  return rows.filter((r) => !deadIds.has(r.delivery.id));
}

export function truncateBody(body: string): string {
  return Buffer.byteLength(body) <= RESPONSE_BODY_MAX_BYTES
    ? body
    : Buffer.from(body).subarray(0, RESPONSE_BODY_MAX_BYTES).toString('utf8');
}

export async function recordDeliveryOutcome(
  due: DueDelivery,
  outcome: DeliveryOutcome,
  at: Date = new Date()
): Promise<RecordOutcomeResult> {
  const { delivery, webhook } = due;
  const now = floorToSecond(at);
  const attempt = delivery.attempt + 1;
  const success = outcome.kind === 'response' && outcome.status >= 200 && outcome.status < 300;
  const responseStatus = outcome.kind === 'response' ? outcome.status : null;
  const responseBody = truncateBody(outcome.kind === 'response' ? outcome.body : outcome.message);

  if (success) {
    await db
      .update(webhookDeliveries)
      .set({
        attempt,
        status: 'delivered',
        responseStatus,
        responseBody,
        deliveredAt: now,
        nextAttemptAt: null
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    await db
      .update(outboundWebhooks)
      .set({
        lastDeliveryAt: now,
        lastStatus: responseStatus,
        failureStreak: 0,
        failingSince: null
      })
      .where(eq(outboundWebhooks.id, webhook.id));
    return { deliveryStatus: 'delivered', nextAttemptAt: null, disabledNow: false };
  }

  const delay = backoffDelayMs(attempt);
  const nextAttemptAt = delay === null ? null : new Date(now.getTime() + delay);
  const deliveryStatus = delay === null ? 'dead' : 'failed';
  await db
    .update(webhookDeliveries)
    .set({ attempt, status: deliveryStatus, responseStatus, responseBody, nextAttemptAt })
    .where(eq(webhookDeliveries.id, delivery.id));

  // Pings never count against the webhook: a merchant testing a broken
  // endpoint must not disable the plugin's subscription.
  if (delivery.event === 'ping') {
    return { deliveryStatus, nextAttemptAt, disabledNow: false };
  }
  // Increment in SQL, then decide on the fresh row: the row joined at claim
  // time is stale once several deliveries of the same webhook sit in one batch.
  await db
    .update(outboundWebhooks)
    .set({
      lastDeliveryAt: now,
      lastStatus: responseStatus,
      failureStreak: sql`${outboundWebhooks.failureStreak} + 1`,
      failingSince: sql`COALESCE(${outboundWebhooks.failingSince}, ${now})`
    })
    .where(eq(outboundWebhooks.id, webhook.id));
  const [fresh] = await db
    .select({
      failureStreak: outboundWebhooks.failureStreak,
      failingSince: outboundWebhooks.failingSince,
      disabledAt: outboundWebhooks.disabledAt
    })
    .from(outboundWebhooks)
    .where(eq(outboundWebhooks.id, webhook.id));
  if (
    !fresh ||
    fresh.disabledAt !== null ||
    !shouldDisable(fresh.failureStreak, fresh.failingSince, now)
  ) {
    return { deliveryStatus, nextAttemptAt, disabledNow: false };
  }
  const [res] = await db
    .update(outboundWebhooks)
    .set({ enabled: false, disabledAt: now })
    .where(and(eq(outboundWebhooks.id, webhook.id), isNull(outboundWebhooks.disabledAt)));
  return { deliveryStatus, nextAttemptAt, disabledNow: res.affectedRows > 0 };
}

/** Retention sweep (spec: 14 days). */
export async function deleteDeliveriesBefore(cutoff: Date): Promise<number> {
  const [res] = await db.delete(webhookDeliveries).where(lte(webhookDeliveries.createdAt, cutoff));
  return res.affectedRows;
}
