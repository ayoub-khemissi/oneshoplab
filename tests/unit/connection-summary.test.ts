import { describe, expect, it } from 'vitest';
import {
  summarizeConnection,
  type ConnectionSummaryInput
} from '@/features/integrations/lib/connection-summary';
import type { SiteKeySummary } from '@/features/integrations/model/types';
import type { ShopifyConnectionView } from '@/entities/shop-connection/client';

function key(state: SiteKeySummary['state']): SiteKeySummary {
  return {
    id: `k-${state}`,
    name: 'test',
    prefix: 'osl_live_abc',
    state,
    createdAtIso: '2026-08-01T00:00:00.000Z',
    lastUsedAtIso: null,
    expiresAtIso: null,
    graceUntilIso: null,
    revokedAtIso: null
  };
}

function connection(over: Partial<ShopifyConnectionView> = {}): ShopifyConnectionView {
  return {
    status: 'connected',
    platform: 'shopify',
    authMode: 'oauth',
    shopDomain: 'demo.myshopify.com',
    shopName: 'Demo',
    lastPullAtIso: '2026-08-30T10:00:00.000Z',
    pullProgress: null,
    pullPending: false,
    lastWebhookAtIso: null,
    lastError: null,
    hasWebhookSecret: true,
    ...over
  };
}

const base: ConnectionSummaryInput = {
  platform: null,
  comingSoon: false,
  keys: [],
  lastUsedAtIso: null,
  productCount: 0,
  connection: null
};

describe('summarizeConnection', () => {
  it('is idle before anything is chosen', () => {
    const s = summarizeConnection(base);
    expect(s.state).toBe('idle');
    expect(s.tone).toBe('idle');
    expect(s.next).toBe('platform');
    expect(s.steps.every((step) => !step.done)).toBe(true);
  });

  it('a platform alone is only a start', () => {
    const s = summarizeConnection({ ...base, platform: 'woocommerce' });
    expect(s.state).toBe('partial');
    expect(s.tone).toBe('warn');
    expect(s.next).toBe('credential');
  });

  it('a platform we cannot connect yet does not count as chosen', () => {
    const s = summarizeConnection({ ...base, platform: 'wix', comingSoon: true });
    expect(s.steps[0].done).toBe(false);
    expect(s.state).toBe('idle');
  });

  it('a key that never called is not a connection', () => {
    const s = summarizeConnection({
      ...base,
      platform: 'woocommerce',
      keys: [key('active')],
      productCount: 12
    });
    expect(s.steps[1].done).toBe(true);
    expect(s.state).toBe('partial');
    expect(s.next).toBe('sync');
  });

  it('a plugin that called with a catalog is connected', () => {
    const s = summarizeConnection({
      ...base,
      platform: 'woocommerce',
      keys: [key('active')],
      lastUsedAtIso: '2026-08-31T09:00:00.000Z',
      productCount: 9
    });
    expect(s.state).toBe('connected');
    expect(s.tone).toBe('ok');
    expect(s.next).toBeNull();
  });

  it('warns while the only live key is in its grace period', () => {
    const s = summarizeConnection({
      ...base,
      platform: 'woocommerce',
      keys: [key('revoked'), key('grace')],
      lastUsedAtIso: '2026-08-31T09:00:00.000Z',
      productCount: 9
    });
    expect(s.state).toBe('connected');
    expect(s.tone).toBe('warn');
    expect(s.problem).toBe('keyGraceOnly');
  });

  it('flags a store whose keys all died', () => {
    const s = summarizeConnection({
      ...base,
      platform: 'woocommerce',
      keys: [key('expired'), key('revoked')],
      productCount: 9
    });
    expect(s.tone).toBe('danger');
    expect(s.problem).toBe('keysDead');
    expect(s.next).toBe('credential');
  });

  it('an app store is connected through its connection, not a key', () => {
    const s = summarizeConnection({
      ...base,
      platform: 'shopify',
      productCount: 40,
      connection: connection()
    });
    expect(s.state).toBe('connected');
    expect(s.tone).toBe('ok');
  });

  it('an invalid token outranks everything else', () => {
    const s = summarizeConnection({
      ...base,
      platform: 'shopify',
      productCount: 40,
      connection: connection({ status: 'token_invalid' })
    });
    expect(s.tone).toBe('danger');
    expect(s.state).toBe('attention');
    expect(s.problem).toBe('tokenInvalid');
  });

  it('an app installed but never pulled is still partial', () => {
    const s = summarizeConnection({
      ...base,
      platform: 'wix',
      productCount: 0,
      connection: connection({ platform: 'wix', lastPullAtIso: null })
    });
    expect(s.state).toBe('partial');
    expect(s.next).toBe('sync');
  });
});
