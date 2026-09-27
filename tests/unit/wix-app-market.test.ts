import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKS,
  PLAN_TIERS,
  shopifyPackPrice,
  shopifyPlanPrice,
  wixPackPrice,
  wixPlanPrice
} from '@/entities/ai-model';
import {
  createStoreLinkToken,
  isWixSessionToken,
  signWixSessionToken,
  verifyStoreLinkToken,
  verifyWixSessionToken
} from '@/entities/shop-connection';
import { parseWixWebhookClaims } from '@/features/wix-connector';
import { embeddedHostOf, embeddedLinkAction, embeddedRequestInfo } from '@/shared/embedded/lib';

const SECRET = 'wix-app-secret-for-tests';
const NOW = 1_790_000_000;

describe('Wix session token', () => {
  it('round-trips, expires after two hours and resists tampering', () => {
    const token = signWixSessionToken('inst-1', SECRET, NOW);
    expect(verifyWixSessionToken(token, SECRET, NOW + 60)).toEqual({
      instanceId: 'inst-1',
      exp: NOW + 7200
    });
    expect(verifyWixSessionToken(token, SECRET, NOW + 7200)).toBeNull();
    expect(verifyWixSessionToken(token, 'other-secret', NOW)).toBeNull();
    const [h, , s] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ iss: 'oneshoplab:wix', sub: 'inst-2', exp: NOW + 99 })
    ).toString('base64url');
    expect(verifyWixSessionToken(`${h}.${forged}.${s}`, SECRET, NOW)).toBeNull();
  });

  it('is told apart from a Shopify ID token by its issuer', () => {
    expect(isWixSessionToken(signWixSessionToken('inst-1', SECRET, NOW))).toBe(true);
    const shopify = `e30.${Buffer.from(JSON.stringify({ iss: 'https://a.myshopify.com/admin' })).toString('base64url')}.sig`;
    expect(isWixSessionToken(shopify)).toBe(false);
    expect(isWixSessionToken('not-a-token')).toBe(false);
  });
});

describe('embedded host routing', () => {
  const wixToken = signWixSessionToken('inst-1', SECRET, NOW);
  it('finds the Wix admin from the path, our token or a Wix referrer; Shopify otherwise', () => {
    expect(embeddedHostOf({ bearer: null, pathname: '/wix', referer: null })).toBe('wix');
    expect(embeddedHostOf({ bearer: wixToken, pathname: '/fr/dashboard', referer: null })).toBe(
      'wix'
    );
    expect(
      embeddedHostOf({
        bearer: null,
        pathname: '/fr/dashboard',
        referer: 'https://jane-shop.editor.wix.com/'
      })
    ).toBe('wix');
    expect(embeddedHostOf({ bearer: 'a.e30.c', pathname: '/fr/dashboard', referer: null })).toBe(
      'shopify'
    );
    expect(embeddedHostOf({ bearer: null, pathname: '/fr', referer: 'https://evilwix.com/' })).toBe(
      'shopify'
    );
  });

  it('a document load inside Wix brings its session as osl_token', () => {
    expect(
      embeddedRequestInfo({
        secFetchDest: 'iframe',
        authorization: null,
        idTokenParam: null,
        wixTokenParam: wixToken
      })
    ).toEqual({ embedded: true, bearer: wixToken });
  });

  it('a link to the Wix home keeps the session (home), the Shopify home stays a plain load', () => {
    const o = 'https://oneshoplab.com';
    expect(embeddedLinkAction({ href: '/wix?locale=fr', target: null, download: false }, o)).toBe(
      'home'
    );
    expect(
      embeddedLinkAction({ href: '/shopify?locale=fr', target: null, download: false }, o)
    ).toBe('ignore');
  });
});

describe('store link tokens', () => {
  it('are bound to their store platform and expire', () => {
    process.env.AUTH_SECRET ??= 'test-auth-secret-'.padEnd(40, 'x');
    const t = createStoreLinkToken('wix', 'inst-1', 1000);
    expect(verifyStoreLinkToken('wix', t, 1000)).toBe('inst-1');
    expect(verifyStoreLinkToken('shopify', t, 1000)).toBeNull();
    expect(verifyStoreLinkToken('wix', t, 1000 + 16 * 60_000)).toBeNull();
  });
});

describe('Wix webhook classification', () => {
  const claims = (eventType: string) => ({
    data: JSON.stringify({ data: '{}', instanceId: 'inst-1', eventType })
  });
  it('billing and install events are not product events', () => {
    expect(parseWixWebhookClaims(claims('PaidPlanChanged'))?.kind).toBe('billing');
    expect(parseWixWebhookClaims(claims('PaidPlanPurchased'))?.kind).toBe('billing');
    expect(parseWixWebhookClaims(claims('PaidPlanAutoRenewalCancelled'))?.kind).toBe('billing');
    expect(parseWixWebhookClaims(claims('AppInstalled'))?.kind).toBe('app_installed');
    expect(parseWixWebhookClaims(claims('AppRemoved'))?.kind).toBe('app_removed');
    expect(parseWixWebhookClaims(claims('ProductChanged'))?.kind).toBe('updated');
  });
});

describe('Wix prices', () => {
  const paid = PLAN_TIERS.filter((t) => t.id !== 'free') as Array<
    (typeof PLAN_TIERS)[number] & { id: 'starter' | 'pro' | 'scale' }
  >;
  it('carry the long-term Wix cut: above Shopify, net ≥ Shopify after year one', () => {
    for (const t of paid) {
      expect(wixPlanPrice(t.id, 'monthly') * 0.78).toBeGreaterThanOrEqual(
        shopifyPlanPrice(t.id, 'monthly') * 0.971 * 0.99
      );
      expect(wixPlanPrice(t.id, 'yearly')).toBeCloseTo(wixPlanPrice(t.id, 'monthly') * 12 * 0.8, 1);
    }
    for (const p of CREDIT_PACKS) {
      expect(wixPackPrice(p.id) * 0.78).toBeGreaterThanOrEqual(
        shopifyPackPrice(p.id) * 0.971 * 0.99
      );
    }
  });

  it('rank offers by price per credit exactly as the site does', () => {
    const offers = [
      ...paid.map((t) => ({
        id: t.id,
        eur: t.priceEur / t.credits,
        usd: wixPlanPrice(t.id, 'monthly') / t.credits
      })),
      ...CREDIT_PACKS.map((p) => ({
        id: p.id,
        eur: p.priceEur / p.credits,
        usd: wixPackPrice(p.id) / p.credits
      }))
    ];
    const byEur = [...offers].sort((a, b) => a.eur - b.eur).map((o) => o.id);
    const byUsd = [...offers].sort((a, b) => a.usd - b.usd).map((o) => o.id);
    expect(byUsd).toEqual(byEur);
  });
});
