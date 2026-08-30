import { describe, expect, it } from 'vitest';
// Relative path on purpose: the slice entries load next-intl through the wizard.
import {
  parseIntegrationReturn,
  shopifyReturnError,
  wixReturnError
} from '../../src/features/integrations/lib/return-params';

describe('OAuth return params of the Integrations tab', () => {
  it('reads a successful Shopify install with its webhook warning', () => {
    expect(parseIntegrationReturn({ connected: 'shopify' })).toEqual({
      kind: 'connected',
      platform: 'shopify',
      warning: null
    });
    expect(parseIntegrationReturn({ connected: 'shopify', warning: 'webhooks_failed' })).toEqual({
      kind: 'connected',
      platform: 'shopify',
      warning: 'webhooks_failed'
    });
    expect(parseIntegrationReturn({ connected: 'wix', warning: 'whatever' })).toEqual({
      kind: 'connected',
      platform: 'wix',
      warning: null
    });
  });

  it('reads an error and ignores unknown platforms / empty params', () => {
    expect(parseIntegrationReturn({ error: 'bad_state' })).toEqual({
      kind: 'error',
      reason: 'bad_state'
    });
    expect(parseIntegrationReturn({ connected: 'ebay', error: ' ' })).toEqual({ kind: 'none' });
    expect(parseIntegrationReturn({})).toEqual({ kind: 'none' });
    expect(parseIntegrationReturn({ error: 'x'.repeat(100) })).toEqual({
      kind: 'error',
      reason: 'x'.repeat(40)
    });
  });

  it('maps reasons to the known per-platform message keys', () => {
    expect(shopifyReturnError('scopes_missing')).toBe('scopes_missing');
    expect(shopifyReturnError('invalid_token')).toBe('unknown');
    expect(wixReturnError('invalid_token')).toBe('invalid_token');
    expect(wixReturnError('scopes_missing')).toBe('unknown');
    expect(wixReturnError('<script>')).toBe('unknown');
  });
});
