/**
 * Stripe replays events; the webhook must be idempotent on the money path.
 * Signatures are real (stripe's own test-header helper), the Stripe API is
 * stubbed, the ledger is the real *_test database.
 */
import Stripe from 'stripe';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const stripeStub = {
  webhooks: new Stripe('sk_test_placeholder').webhooks,
  checkout: { sessions: { listLineItems: vi.fn().mockRejectedValue(new Error('offline')) } },
  subscriptions: { retrieve: vi.fn() }
};
// stripe-actions pulls next-auth (and with it next/server internals that
// don't resolve under vitest); the subscription sync path is out of scope here.
vi.mock('@/lib/stripe-actions', () => ({ syncSubscriptionFromStripe: vi.fn() }));
vi.mock('@/lib/stripe', () => ({
  getStripeClient: () => stripeStub,
  getStripeWebhookSecret: () => 'whsec_test_placeholder',
  resolvePackPriceId: () => null,
  resolvePriceId: () => null
}));

import { POST } from '@/app/api/stripe/webhook/route';
import { getCreditPack } from '@/entities/ai-model';
import { db } from '@/lib/db';
import { buckets, createUser, ledgerCount, resetTables } from './helpers';

function signedRequest(event: object): Request {
  const payload = JSON.stringify(event);
  const signature = stripeStub.webhooks.generateTestHeaderString({
    payload,
    secret: 'whsec_test_placeholder'
  });
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: payload
  });
}

function packCheckoutEvent(userId: string, sessionId: string) {
  return {
    id: `evt_${sessionId}`,
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2026-04-22.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        payment_intent: `pi_${sessionId}`,
        metadata: { oneshoplabUserId: userId, packId: 'boost' },
        consent: { terms_of_service: 'accepted' }
      }
    }
  };
}

beforeEach(resetTables);
afterAll(async () => {
  await db.$client.end();
});

describe('POST /api/stripe/webhook', () => {
  it('rejects a missing or forged signature', async () => {
    const noSig = await POST(
      new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}' })
    );
    expect(noSig.status).toBe(400);
    const forged = await POST(
      new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=deadbeef' },
        body: '{}'
      })
    );
    expect(forged.status).toBe(400);
  });

  it('grants a credit pack once, however many times Stripe replays the event', async () => {
    const userId = await createUser();
    const boost = getCreditPack('boost')!;
    const event = packCheckoutEvent(userId, 'cs_replay');

    const first = await POST(signedRequest(event));
    expect(first.status).toBe(200);
    const replays = await Promise.all([1, 2, 3].map(() => POST(signedRequest(event))));
    for (const r of replays) expect(r.status).toBe(200);

    expect(await buckets(userId)).toEqual({ total: boost.credits, sub: 0, pack: boost.credits });
    expect(await ledgerCount(userId)).toBe(1);
  });

  it('records the checkout Terms consent once per session', async () => {
    const userId = await createUser();
    const event = packCheckoutEvent(userId, 'cs_consent');
    await POST(signedRequest(event));
    await POST(signedRequest(event));
    const consents = await db.query.legalConsents.findMany();
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ userId, kind: 'checkout_tos' });
  });

  it('ignores unpaid sessions and unrelated event types', async () => {
    const userId = await createUser();
    const unpaid = packCheckoutEvent(userId, 'cs_unpaid');
    unpaid.data.object.payment_status = 'unpaid';
    expect((await POST(signedRequest(unpaid))).status).toBe(200);
    expect(
      (
        await POST(
          signedRequest({ ...packCheckoutEvent(userId, 'cs_x'), type: 'payment_intent.created' })
        )
      ).status
    ).toBe(200);
    expect(await ledgerCount(userId)).toBe(0);
  });
});
