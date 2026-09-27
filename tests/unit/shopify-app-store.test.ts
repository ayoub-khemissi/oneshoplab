import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKS,
  PLAN_TIERS,
  parseShopifyPlanChargeName,
  shopifyPackPrice,
  shopifyPlanChargeName,
  shopifyPlanPrice,
  YEARLY_DISCOUNT
} from '@/entities/ai-model';
import { nextRefill } from '@/entities/credit/lib/refill';
import {
  bearerFrom,
  signShopifyIdTokenForTests,
  verifyShopifyIdToken
} from '@/features/shopify-connector/lib/id-token';
import { packChargeName, parsePackChargeName } from '@/features/shopify-connector';

const CFG = { clientId: 'client-id', clientSecret: 'shpss_' + 'z'.repeat(32) };
const NOW = 1_800_000_000;

function claims(patch: Record<string, unknown> = {}) {
  return {
    iss: 'https://atelier.myshopify.com/admin',
    dest: 'https://atelier.myshopify.com',
    aud: CFG.clientId,
    sub: '42',
    exp: NOW + 60,
    nbf: NOW - 5,
    iat: NOW - 5,
    jti: 'j',
    sid: 's',
    ...patch
  };
}

describe('verifyShopifyIdToken', () => {
  it('accepts a well-formed token and returns the shop', () => {
    const t = signShopifyIdTokenForTests(claims(), CFG.clientSecret);
    expect(verifyShopifyIdToken(t, CFG, NOW)).toEqual({
      shop: 'atelier.myshopify.com',
      userId: '42',
      sessionId: 's',
      exp: NOW + 60
    });
  });

  it('rejects another secret, audience, expired or future tokens, and iss/dest mismatches', () => {
    const cases: Array<[string, string]> = [
      ['secret', signShopifyIdTokenForTests(claims(), 'other')],
      ['aud', signShopifyIdTokenForTests(claims({ aud: 'someone-else' }), CFG.clientSecret)],
      ['exp', signShopifyIdTokenForTests(claims({ exp: NOW - 11 }), CFG.clientSecret)],
      ['nbf', signShopifyIdTokenForTests(claims({ nbf: NOW + 11 }), CFG.clientSecret)],
      [
        'dest',
        signShopifyIdTokenForTests(
          claims({ dest: 'https://other.myshopify.com' }),
          CFG.clientSecret
        )
      ],
      [
        'not myshopify',
        signShopifyIdTokenForTests(
          claims({ iss: 'https://evil.example/admin', dest: 'https://evil.example' }),
          CFG.clientSecret
        )
      ]
    ];
    for (const [label, token] of cases) {
      expect(verifyShopifyIdToken(token, CFG, NOW), label).toBeNull();
    }
    expect(verifyShopifyIdToken('a.b', CFG, NOW)).toBeNull();
    expect(verifyShopifyIdToken(null, CFG, NOW)).toBeNull();
  });

  it('tolerates 10 s of clock skew', () => {
    const t = signShopifyIdTokenForTests(claims({ exp: NOW - 9 }), CFG.clientSecret);
    expect(verifyShopifyIdToken(t, CFG, NOW)?.shop).toBe('atelier.myshopify.com');
  });

  it('reads the Bearer header App Bridge adds', () => {
    expect(bearerFrom(new Headers({ authorization: 'Bearer abc.def.ghi' }))).toBe('abc.def.ghi');
    expect(bearerFrom(new Headers())).toBeNull();
  });
});

describe('Shopify charge names', () => {
  it('round-trips every paid plan and cycle', () => {
    for (const tier of PLAN_TIERS.filter((t) => t.id !== 'free')) {
      for (const cycle of ['monthly', 'yearly'] as const) {
        const plan = tier.id as 'starter' | 'pro' | 'scale';
        expect(parseShopifyPlanChargeName(shopifyPlanChargeName(plan, cycle))).toEqual({
          plan,
          cycle
        });
      }
    }
    expect(parseShopifyPlanChargeName('OneShopLab Free (monthly)')).toBeNull();
    expect(parseShopifyPlanChargeName('Other app Pro (monthly)')).toBeNull();
  });

  it('round-trips every pack', () => {
    for (const pack of CREDIT_PACKS) {
      expect(parsePackChargeName(packChargeName(pack.id))).toBe(pack.id);
    }
    expect(packChargeName('catalog')).toBe('OneShopLab Catalog pack (40000 credits)');
    expect(parsePackChargeName('OneShopLab Pro (monthly)')).toBeNull();
  });
});

describe('Shopify prices', () => {
  // EUR/USD 1.1382, Shopify's 2.9% fee absorbed: what we keep per sale must
  // stay within 3% of the euro price, and never below it by more than that.
  const RATE = 1.1382;
  const FEE = 0.029;

  it('nets the euro price on every plan and pack', () => {
    for (const tier of PLAN_TIERS.filter((t) => t.id !== 'free')) {
      const usd = shopifyPlanPrice(tier.id as 'starter' | 'pro' | 'scale', 'monthly');
      const netEur = (usd * (1 - FEE)) / RATE;
      expect(Math.abs(netEur - tier.priceEur) / tier.priceEur, tier.id).toBeLessThan(0.03);
    }
    for (const pack of CREDIT_PACKS) {
      const netEur = (shopifyPackPrice(pack.id) * (1 - FEE)) / RATE;
      expect(Math.abs(netEur - pack.priceEur) / pack.priceEur, pack.id).toBeLessThan(0.03);
    }
  });

  it('bills yearly as twelve months minus the yearly discount', () => {
    expect(shopifyPlanPrice('pro', 'yearly')).toBeCloseTo(
      shopifyPlanPrice('pro', 'monthly') * 12 * (1 - YEARLY_DISCOUNT),
      2
    );
  });

  it('ranks every offer by price per credit exactly as the site does', () => {
    type Offer = { id: string; eur: number; usd: number };
    const offers: Offer[] = [
      ...PLAN_TIERS.filter((t) => t.id !== 'free').map((t) => ({
        id: t.id,
        eur: t.priceEur / t.credits,
        usd: shopifyPlanPrice(t.id as 'starter' | 'pro' | 'scale', 'monthly') / t.credits
      })),
      ...CREDIT_PACKS.map((p) => ({
        id: p.id,
        eur: p.priceEur / p.credits,
        usd: shopifyPackPrice(p.id) / p.credits
      }))
    ];
    const byEur = [...offers].sort((a, b) => a.eur - b.eur).map((o) => o.id);
    const byUsd = [...offers].sort((a, b) => a.usd - b.usd).map((o) => o.id);
    expect(byUsd).toEqual(byEur);
  });
});

describe('nextRefill', () => {
  it('moves a monthly Shopify plan 30 days on', () => {
    const from = new Date('2026-01-31T10:00:00Z');
    expect(nextRefill(from, 'monthly').toISOString()).toBe('2026-03-02T10:00:00.000Z');
  });

  it('moves a yearly plan one calendar month on, clamped, keeping its anchor day', () => {
    const jan31 = new Date('2026-01-31T10:00:00Z');
    const feb = nextRefill(jan31, 'yearly');
    expect(feb.toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(nextRefill(feb, 'yearly', 31).toISOString()).toBe('2026-03-31T10:00:00.000Z');
    expect(nextRefill(new Date('2026-12-15T00:00:00Z'), 'yearly').toISOString()).toBe(
      '2027-01-15T00:00:00.000Z'
    );
  });
});
