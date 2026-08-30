/**
 * Outbound webhooks: self-registration routes (secret once, rotation,
 * delete, deliveries, ping), fan-out to subscribed webhooks, the delivery
 * loop with a stubbed fetch (2xx, retries, dead, auto-disable + alert),
 * retention sweep and the `change.approved` hook in createChange.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('@/shared/mailer', () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));
// Routes cannot take a lookup stub: every test hostname resolves to a public address.
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }]
}));

import { GET as DELIVERIES } from '@/app/api/v1/webhooks/self/deliveries/route';
import { POST as PING } from '@/app/api/v1/webhooks/self/ping/route';
import { DELETE as DEL, PUT } from '@/app/api/v1/webhooks/self/route';
import { buildSignatureHeader, createApiKey } from '@/entities/api-key';
import {
  BACKOFF_SCHEDULE_MS,
  DISABLE_AFTER_FAILURES,
  WEBHOOK_SECRET_PREFIX,
  createManualWebhook,
  emitProjectEvent,
  enqueuePing,
  listDeliveries,
  listWebhooks,
  upsertSelfWebhook,
  verifyWebhookSignature
} from '@/entities/outbound-webhook';
import { createChange } from '@/entities/product-change';
import { drainWebhookDeliveries, sweepWebhookDeliveries } from '@/features/webhook-delivery';
import { resetRateLimits } from '@/shared/api';
import { db } from '@/shared/db';
import { notifications, outboundWebhooks, webhookDeliveries } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

const URL_A = 'https://shop-a.example.com/wp-json/oneshoplab/v1/webhook';
const URL_B = 'https://shop-b.example.com/hook';
let userId: string;
let projectId: string;
let key: string;

beforeEach(async () => {
  await resetTables();
  resetRateLimits();
  sendMail.mockClear();
  userId = await createUser();
  projectId = await createProject(userId, 'Atelier');
  const res = await createApiKey({ projectId, userId, name: 'plugin' });
  if (!res.ok) throw new Error('key');
  key = res.value.plaintext;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await db.$client.end();
});

function request(method: string, path: string, body?: unknown, bearer = key): Request {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      'x-osl-signature': buildSignatureHeader(bearer, {
        method,
        path: new URL(path, 'http://localhost').pathname,
        body: raw
      })
    },
    body: method === 'GET' ? undefined : raw
  });
}
async function json(pending: Response | Promise<Response>) {
  const res = await pending;
  return { status: res.status, body: await res.json() };
}
const put = (body: unknown) => json(PUT(request('PUT', '/api/v1/webhooks/self', body)));
async function deliveryRows() {
  return db.select().from(webhookDeliveries);
}
async function hookRow(id: string) {
  const [r] = await db.select().from(outboundWebhooks).where(eq(outboundWebhooks.id, id));
  return r;
}
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(handler);
  vi.stubGlobal('fetch', fn);
  return fn;
}
async function selfHook(url = URL_A) {
  const res = await upsertSelfWebhook(projectId, { url });
  if (!res.ok) throw new Error(res.reason);
  return res;
}

describe('PUT/DELETE /webhooks/self', () => {
  it('creates once, returns the secret once, sealed at rest', async () => {
    const r = await put({ url: URL_A });
    expect(r.status).toBe(201);
    expect(r.body.secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    const row = await hookRow(r.body.id);
    expect(row.kind).toBe('self');
    expect(row.events).toHaveLength(5);
    expect(row.secretCiphertext.startsWith('v1:')).toBe(true);
    expect(row.secretCiphertext).not.toContain(r.body.secret);
    const views = await listWebhooks(projectId);
    expect(views).toHaveLength(1);
    expect(JSON.stringify(views)).not.toContain(r.body.secret);
    expect(Object.keys(views[0])).not.toContain('secretCiphertext');
  });

  it('re-PUT same url rotates the secret and keeps the id; new url replaces the self hook', async () => {
    const a = await put({ url: URL_A, events: ['change.approved'] });
    const b = await put({ url: URL_A });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.secret).not.toBe(a.body.secret);
    expect((await hookRow(a.body.id)).events).toHaveLength(5);
    const c = await put({ url: URL_B });
    expect(c.status).toBe(201);
    expect(c.body.id).not.toBe(a.body.id);
    expect(await listWebhooks(projectId)).toHaveLength(1);
  });

  it('rejects http / private / localhost urls with a 422 reason', async () => {
    expect(await put({ url: 'http://shop.example.com/hook' })).toMatchObject({
      status: 422,
      body: { error: { code: 'validation', details: { reason: 'not_https' } } }
    });
    expect((await put({ url: 'https://127.0.0.1/hook' })).body.error.details.reason).toBe(
      'private_address'
    );
    expect((await put({ url: 'https://localhost/hook' })).body.error.details.reason).toBe(
      'blocked_host'
    );
    expect((await put({ url: URL_A, events: ['nope'] })).status).toBe(422);
  });

  it('needs the webhooks:manage permission', async () => {
    const ro = await createApiKey({ projectId, userId, name: 'ro', permissions: ['changes:read'] });
    if (!ro.ok) throw new Error('key');
    const r = await json(
      PUT(request('PUT', '/api/v1/webhooks/self', { url: URL_A }, ro.value.plaintext))
    );
    expect(r.status).toBe(403);
  });

  it('DELETE removes the self webhook (and its deliveries), idempotent', async () => {
    const a = await put({ url: URL_A });
    await enqueuePing(a.body.id);
    expect(await json(DEL(request('DELETE', '/api/v1/webhooks/self')))).toMatchObject({
      status: 200,
      body: { deleted: true }
    });
    expect((await json(DEL(request('DELETE', '/api/v1/webhooks/self')))).body.deleted).toBe(false);
    expect(await deliveryRows()).toHaveLength(0);
  });

  it('ping enqueues a delivery; deliveries lists newest first without payloads', async () => {
    expect((await json(PING(request('POST', '/api/v1/webhooks/self/ping')))).status).toBe(404);
    const a = await put({ url: URL_A });
    const p = await json(PING(request('POST', '/api/v1/webhooks/self/ping')));
    expect(p.status).toBe(202);
    await emitProjectEvent(projectId, 'sync.completed', { source: 'plugin' });
    const l = await json(DELIVERIES(request('GET', '/api/v1/webhooks/self/deliveries?limit=1')));
    expect(l.status).toBe(200);
    expect(l.body.webhook.id).toBe(a.body.id);
    expect(l.body.deliveries).toHaveLength(1);
    expect(l.body.deliveries[0]).toMatchObject({
      event: 'sync.completed',
      status: 'pending',
      attempt: 0
    });
    expect(l.body.deliveries[0]).not.toHaveProperty('payload');
    const all = await json(DELIVERIES(request('GET', '/api/v1/webhooks/self/deliveries')));
    expect(all.body.deliveries.map((d: { id: string }) => d.id)).toContain(p.body.deliveryId);
    expect(
      (await json(DELIVERIES(request('GET', '/api/v1/webhooks/self/deliveries?limit=0')))).status
    ).toBe(422);
  });
});

describe('emitProjectEvent', () => {
  it('fans out only to enabled webhooks subscribed to the event, one eventId', async () => {
    const self = await selfHook(URL_A);
    const manual = await createManualWebhook(projectId, { url: URL_B, events: ['sync.failed'] });
    const other = await createManualWebhook(projectId, {
      url: 'https://shop-c.example.com/hook',
      events: ['change.approved']
    });
    if (!manual.ok || !other.ok) throw new Error('hook');
    await db
      .update(outboundWebhooks)
      .set({ enabled: false })
      .where(eq(outboundWebhooks.id, other.id));
    const otherProject = await createProject(userId);
    await createManualWebhook(otherProject, { url: URL_A });

    const res = await emitProjectEvent(projectId, 'change.approved', { id: 'x' });
    const rows = await deliveryRows();
    expect(res.deliveryIds).toHaveLength(1);
    expect(rows.map((r) => r.webhookId)).toEqual([self.id]);
    expect(rows[0]).toMatchObject({
      eventId: res.eventId,
      status: 'pending',
      attempt: 0,
      payload: { id: 'x' }
    });
    expect(rows[0].nextAttemptAt).not.toBeNull();
  });

  it('createChange emits change.approved with the /changes wire shape', async () => {
    const hook = await selfHook();
    const product = await createProduct(projectId);
    const created = await createChange({
      projectId,
      productId: product.id,
      productSourceId: product.sourceId,
      field: 'title',
      value: 'New',
      approvedBy: userId
    });
    if (!created.ok) throw new Error('change');
    const [row] = await deliveryRows();
    expect(row.webhookId).toBe(hook.id);
    expect(row.event).toBe('change.approved');
    expect(row.payload).toMatchObject({
      id: created.change.id,
      productSourceId: product.sourceId,
      field: 'title',
      value: 'New',
      approvedAt: created.change.approvedAt.toISOString(),
      expiresAt: null
    });
  });
});

describe('drainWebhookDeliveries', () => {
  it('2xx → delivered, signed body, headers, webhook stats', async () => {
    const hook = await selfHook();
    const res = await emitProjectEvent(projectId, 'change.approved', { id: 'c1' });
    const fetchFn = stubFetch(() => new Response('ok', { status: 200 }));
    const tally = await drainWebhookDeliveries();
    expect(tally).toEqual({ processed: 1, delivered: 1, failed: 0, disabled: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_A);
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      id: res.eventId,
      event: 'change.approved',
      projectId,
      data: { id: 'c1' }
    });
    expect(headers['X-OSL-Event']).toBe('change.approved');
    expect(headers['X-OSL-Event-Id']).toBe(res.eventId);
    expect(headers['X-OSL-Delivery-Id']).toBe(res.deliveryIds[0]);
    expect(
      verifyWebhookSignature(
        hook.secret,
        headers['X-OSL-Signature'],
        Number(headers['X-OSL-Timestamp']),
        init.body as string
      )
    ).toBe(true);
    const [row] = await deliveryRows();
    expect(row).toMatchObject({
      status: 'delivered',
      attempt: 1,
      responseStatus: 200,
      responseBody: 'ok'
    });
    expect(row.deliveredAt).not.toBeNull();
    const h = await hookRow(hook.id);
    expect(h).toMatchObject({ lastStatus: 200, failureStreak: 0, failingSince: null });
    expect(h.lastDeliveryAt).not.toBeNull();
    // Nothing left to send.
    expect((await drainWebhookDeliveries()).processed).toBe(0);
  });

  it('500 → retry per schedule, dead after 5 attempts; body capped at 1 KiB', async () => {
    const hook = await selfHook();
    let now = new Date('2026-08-30T10:00:00Z');
    await emitProjectEvent(projectId, 'change.approved', { id: 'c1' }, now);
    stubFetch(() => new Response('x'.repeat(5000), { status: 500 }));
    for (let attempt = 1; attempt <= 5; attempt++) {
      const t = await drainWebhookDeliveries({ now });
      expect(t.failed, `attempt ${attempt}`).toBe(1);
      const [row] = await deliveryRows();
      expect(row.attempt).toBe(attempt);
      expect(row.responseStatus).toBe(500);
      expect(row.responseBody?.length).toBe(1024);
      if (attempt < 5) {
        expect(row.status).toBe('failed');
        expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + BACKOFF_SCHEDULE_MS[attempt - 1]);
        // Not due yet one second before the slot.
        expect(
          (await drainWebhookDeliveries({ now: new Date(row.nextAttemptAt!.getTime() - 1000) }))
            .processed
        ).toBe(0);
        now = row.nextAttemptAt!;
      } else {
        expect(row.status).toBe('dead');
        expect(row.nextAttemptAt).toBeNull();
      }
    }
    const h = await hookRow(hook.id);
    expect(h.failureStreak).toBe(5);
    expect(h.failingSince?.getTime()).toBe(new Date('2026-08-30T10:00:00Z').getTime());
    expect(h.disabledAt).toBeNull();
  });

  it('network error / blocked url count as failures; ping never counts', async () => {
    const hook = await selfHook();
    await enqueuePing(hook.id);
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    await drainWebhookDeliveries();
    const [row] = await deliveryRows();
    expect(row).toMatchObject({
      status: 'failed',
      responseStatus: null,
      responseBody: 'TypeError: fetch failed'
    });
    expect((await hookRow(hook.id)).failureStreak).toBe(0);
  });

  it('50 consecutive failures → disabled once + bell/email alert; later events die', async () => {
    const hook = await selfHook();
    for (let i = 0; i < DISABLE_AFTER_FAILURES; i++) {
      await emitProjectEvent(projectId, 'change.approved', { i });
    }
    stubFetch(() => new Response('nope', { status: 503 }));
    const t = await drainWebhookDeliveries();
    expect(t).toMatchObject({ processed: 50, failed: 50, disabled: 1 });
    const h = await hookRow(hook.id);
    expect(h.enabled).toBe(false);
    expect(h.disabledAt).not.toBeNull();
    expect(h.failureStreak).toBe(50);
    const bell = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(bell.map((b) => b.kind)).toEqual(['integration_webhook_disabled']);
    expect(bell[0].payload).toMatchObject({ url: URL_A, siteName: 'Atelier' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((sendMail.mock.calls[0][0] as { subject: string }).subject).toContain('Atelier');

    // Disabled: no new fan-out, pending retries are dropped as dead, no second alert.
    expect(
      (await emitProjectEvent(projectId, 'change.approved', { i: 99 })).deliveryIds
    ).toHaveLength(0);
    const again = await drainWebhookDeliveries({ now: new Date(Date.now() + 120_000) });
    expect(again.processed).toBe(0);
    const rows = await deliveryRows();
    expect(rows.every((r) => r.status === 'dead')).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('7 days of failures disable even with a short streak', async () => {
    const hook = await selfHook();
    await db
      .update(outboundWebhooks)
      .set({ failureStreak: 3, failingSince: new Date('2026-08-20T00:00:00Z') })
      .where(eq(outboundWebhooks.id, hook.id));
    const now = new Date('2026-08-30T00:00:00Z');
    await emitProjectEvent(projectId, 'sync.completed', {}, now);
    stubFetch(() => new Response(null, { status: 500 }));
    const t = await drainWebhookDeliveries({ now });
    expect(t.disabled).toBe(1);
    expect((await hookRow(hook.id)).disabledAt).not.toBeNull();
  });

  it('a success resets the streak', async () => {
    const hook = await selfHook();
    await db
      .update(outboundWebhooks)
      .set({ failureStreak: 10, failingSince: new Date() })
      .where(eq(outboundWebhooks.id, hook.id));
    await emitProjectEvent(projectId, 'sync.completed', {});
    stubFetch(() => new Response(null, { status: 204 }));
    await drainWebhookDeliveries();
    expect(await hookRow(hook.id)).toMatchObject({
      failureStreak: 0,
      failingSince: null,
      lastStatus: 204
    });
  });

  it('batch 50 and per-host serialisation', async () => {
    await selfHook(URL_A);
    await createManualWebhook(projectId, { url: URL_B });
    for (let i = 0; i < 30; i++) await emitProjectEvent(projectId, 'sync.completed', { i });
    let inFlight = new Map<string, number>();
    let overlap = false;
    stubFetch(async (url) => {
      const host = new URL(url).host;
      inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
      if (inFlight.get(host)! > 1) overlap = true;
      await new Promise((r) => setTimeout(r, 2));
      inFlight.set(host, inFlight.get(host)! - 1);
      return new Response(null, { status: 200 });
    });
    const first = await drainWebhookDeliveries();
    expect(first.processed).toBe(50);
    expect(overlap).toBe(false);
    inFlight = new Map();
    expect((await drainWebhookDeliveries()).processed).toBe(10);
  });
});

describe('sweepWebhookDeliveries', () => {
  it('drops deliveries older than 14 days', async () => {
    const hook = await selfHook();
    const oldId = await enqueuePing(hook.id, new Date(Date.now() - 15 * 86_400_000));
    await enqueuePing(hook.id, new Date(Date.now() - 13 * 86_400_000));
    expect(await sweepWebhookDeliveries()).toBe(1);
    const left = await listDeliveries(projectId, 10);
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(oldId);
  });
});
