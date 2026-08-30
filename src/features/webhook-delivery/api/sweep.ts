import { DELIVERY_RETENTION_MS, deleteDeliveriesBefore } from '@/entities/outbound-webhook';

/** Hourly worker sweep: deliveries older than the 14-day retention. */
export async function sweepWebhookDeliveries(now: Date = new Date()): Promise<number> {
  const removed = await deleteDeliveriesBefore(new Date(now.getTime() - DELIVERY_RETENTION_MS));
  if (removed) console.info(`[webhook-delivery] sweep: removed=${removed}`);
  return removed;
}
