/**
 * Worker drain: due deliveries → HTTPS POST with the signed body → state
 * machine. Batch 50, 5 hosts in flight, one delivery at a time per host
 * (a slow receiver never gets hammered by its own backlog). A webhook that
 * auto-disables raises the `integration_webhook_disabled` alert here.
 */
import {
  buildWebhookHeaders,
  checkWebhookUrl,
  claimDueDeliveries,
  openWebhookSecret,
  recordDeliveryOutcome,
  signWebhookBody,
  type DeliveryOutcome,
  type DueDelivery,
  type LookupFn
} from '@/entities/outbound-webhook';
import { integrationAlertRecipient, sendIntegrationAlert } from '@/entities/notification';

export const DRAIN_BATCH_SIZE = 50;
export const DRAIN_CONCURRENCY = 5;
export const DELIVERY_TIMEOUT_MS = 10_000;

export interface DrainOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  batchSize?: number;
  concurrency?: number;
}

export interface DrainResult {
  processed: number;
  delivered: number;
  failed: number;
  disabled: number;
}

/** Wire body (spec → Delivery); `createdAt` is the enqueue time so retries re-sign the same body. */
export function deliveryBody(due: DueDelivery): string {
  const { delivery, webhook } = due;
  return JSON.stringify({
    id: delivery.eventId,
    event: delivery.event,
    createdAt: delivery.createdAt.toISOString(),
    projectId: webhook.projectId,
    data: delivery.payload
  });
}

async function send(due: DueDelivery, opts: DrainOptions): Promise<DeliveryOutcome> {
  const checked = await checkWebhookUrl(due.webhook.url, opts.lookup);
  if (!checked.ok) return { kind: 'error', message: `blocked:${checked.reason}` };
  let secret: string;
  try {
    secret = openWebhookSecret(due.webhook);
  } catch {
    return { kind: 'error', message: 'secret_unreadable' };
  }
  const rawBody = deliveryBody(due);
  const ts = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const headers = buildWebhookHeaders({
    event: due.delivery.event,
    eventId: due.delivery.eventId,
    deliveryId: due.delivery.id,
    ts,
    signature: signWebhookBody(secret, ts, rawBody)
  });
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(checked.url.toString(), {
      method: 'POST',
      headers,
      body: rawBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
    });
    const body = await res.text().catch(() => '');
    return { kind: 'response', status: res.status, body };
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { kind: 'error', message: message.slice(0, 200) };
  }
}

async function alertDisabled(due: DueDelivery): Promise<void> {
  const to = await integrationAlertRecipient(due.webhook.projectId);
  if (!to) return;
  await sendIntegrationAlert({
    ...to,
    kind: 'integration_webhook_disabled',
    params: { url: due.webhook.url }
  }).catch((e) => console.error('[webhook-delivery] alert failed', e));
}

async function deliverOne(due: DueDelivery, opts: DrainOptions, tally: DrainResult): Promise<void> {
  const outcome = await send(due, opts);
  const res = await recordDeliveryOutcome(due, outcome, opts.now);
  tally.processed++;
  if (res.deliveryStatus === 'delivered') tally.delivered++;
  else tally.failed++;
  if (res.disabledNow) {
    tally.disabled++;
    await alertDisabled(due);
  }
}

function groupByHost(rows: DueDelivery[]): DueDelivery[][] {
  const groups = new Map<string, DueDelivery[]>();
  for (const r of rows) {
    let host = r.webhook.url;
    try {
      host = new URL(r.webhook.url).host;
    } catch {
      // Unparseable url: its own lane, rejected by the SSRF check on send.
    }
    const list = groups.get(host) ?? [];
    list.push(r);
    groups.set(host, list);
  }
  return [...groups.values()];
}

let draining = false;

export async function drainWebhookDeliveries(opts: DrainOptions = {}): Promise<DrainResult> {
  const tally: DrainResult = { processed: 0, delivered: 0, failed: 0, disabled: 0 };
  // Single worker process: a tick that overruns must not double-send.
  if (draining) return tally;
  draining = true;
  try {
    const now = opts.now ?? new Date();
    const due = await claimDueDeliveries(opts.batchSize ?? DRAIN_BATCH_SIZE, now);
    if (due.length === 0) return tally;
    const lanes = groupByHost(due);
    const concurrency = Math.max(1, opts.concurrency ?? DRAIN_CONCURRENCY);
    let next = 0;
    const runner = async (): Promise<void> => {
      while (next < lanes.length) {
        const lane = lanes[next++];
        for (const d of lane) {
          await deliverOne(d, { ...opts, now }, tally).catch((e) =>
            console.error('[webhook-delivery] delivery failed', d.delivery.id, e)
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, lanes.length) }, runner));
    return tally;
  } finally {
    draining = false;
  }
}
