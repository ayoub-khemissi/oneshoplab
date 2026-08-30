import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeShopifyQueryHmac,
  missingScopes,
  shopifyAuthorizeUrl,
  verifyShopifyQueryHmac
} from '@/features/shopify-connector';
import { createOauthState, OAUTH_STATE_TTL_MS, verifyOauthState } from '@/shared/lib';

const SECRET = 'shpss_' + 'x'.repeat(32);

function signed(params: Record<string, string>, secret = SECRET): URLSearchParams {
  const sp = new URLSearchParams(params);
  const msg = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  sp.set('hmac', createHmac('sha256', secret).update(msg).digest('hex'));
  return sp;
}

describe('Shopify query HMAC', () => {
  const base = { code: 'abc', shop: 'atelier.myshopify.com', state: 'n1', timestamp: '1700000000' };
  it('accepts Shopify’s sorted-query signature and rejects tampering', () => {
    expect(verifyShopifyQueryHmac(signed(base), SECRET)).toBe(true);
    const tampered = signed(base);
    tampered.set('shop', 'evil.myshopify.com');
    expect(verifyShopifyQueryHmac(tampered, SECRET)).toBe(false);
    expect(verifyShopifyQueryHmac(signed(base, 'other'), SECRET)).toBe(false);
    expect(verifyShopifyQueryHmac(new URLSearchParams(base), SECRET)).toBe(false);
  });
  it('excludes hmac/signature and escapes & % = in the message', () => {
    const sp = signed({ ...base, host: 'a&b=c%d' });
    sp.set('signature', 'legacy');
    expect(verifyShopifyQueryHmac(sp, SECRET)).toBe(false);
    expect(computeShopifyQueryHmac(sp, SECRET)).toBe(
      createHmac('sha256', SECRET)
        .update(
          'code=abc&host=a%26b=c%25d&shop=atelier.myshopify.com&state=n1&timestamp=1700000000'
        )
        .digest('hex')
    );
  });
});

describe('OAuth state cookie', () => {
  const input = { projectId: 'p1', userId: 'u1', locale: 'fr', subject: 'atelier.myshopify.com' };
  it('round-trips and binds the state param to the cookie', () => {
    const { state, cookieValue } = createOauthState(input, SECRET);
    expect(verifyOauthState(cookieValue, state, SECRET)).toMatchObject(input);
    expect(verifyOauthState(cookieValue, 'other-nonce', SECRET)).toBeNull();
    expect(verifyOauthState(cookieValue, state, 'other-secret')).toBeNull();
    expect(verifyOauthState(`${cookieValue}x`, state, SECRET)).toBeNull();
    expect(verifyOauthState(null, state, SECRET)).toBeNull();
  });
  it('expires after 10 minutes', () => {
    const issued = new Date('2026-08-30T10:00:00Z');
    const { state, cookieValue } = createOauthState(input, SECRET, issued);
    const at = (ms: number) => new Date(issued.getTime() + ms);
    expect(verifyOauthState(cookieValue, state, SECRET, at(OAUTH_STATE_TTL_MS - 1))).not.toBeNull();
    expect(verifyOauthState(cookieValue, state, SECRET, at(OAUTH_STATE_TTL_MS + 1))).toBeNull();
  });
});

describe('authorize URL + scopes', () => {
  it('builds the Shopify authorize URL', () => {
    const url = new URL(
      shopifyAuthorizeUrl(
        'atelier.myshopify.com',
        { clientId: 'cid', clientSecret: SECRET, scopes: ['read_products', 'write_products'] },
        'https://osl.test/api/integrations/shopify/callback',
        'nonce'
      )
    );
    expect(url.origin + url.pathname).toBe('https://atelier.myshopify.com/admin/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('read_products,write_products');
    expect(url.searchParams.get('state')).toBe('nonce');
  });
  it('write_x satisfies read_x', () => {
    expect(missingScopes(['read_products', 'write_products'], ['write_products'])).toEqual([]);
    expect(missingScopes(['read_products', 'write_products'], ['read_products'])).toEqual([
      'write_products'
    ]);
  });
});
