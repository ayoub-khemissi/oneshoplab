import { describe, expect, it } from 'vitest';
import { partitionSiteKeys } from '@/features/integrations/lib/key-state';
import type { SiteKeySummary } from '@/features/integrations/model/types';

function k(id: string, state: SiteKeySummary['state'], createdAtIso: string): SiteKeySummary {
  return {
    id,
    name: id,
    prefix: `osl_live_${id}`,
    state,
    createdAtIso,
    lastUsedAtIso: null,
    expiresAtIso: null,
    graceUntilIso: null,
    revokedAtIso: null
  };
}

describe('partitionSiteKeys', () => {
  it('keeps the keys the merchant can act on apart from the dead ones', () => {
    const { live, past } = partitionSiteKeys([
      k('old', 'revoked', '2026-01-01T00:00:00.000Z'),
      k('now', 'active', '2026-08-01T00:00:00.000Z'),
      k('gone', 'expired', '2026-03-01T00:00:00.000Z')
    ]);
    expect(live.map((x) => x.id)).toEqual(['now']);
    expect(past.map((x) => x.id)).toEqual(['gone', 'old']);
  });

  it('puts the active key before one living out its grace period', () => {
    const { live } = partitionSiteKeys([
      k('grace', 'grace', '2026-08-02T00:00:00.000Z'),
      k('active', 'active', '2026-08-01T00:00:00.000Z')
    ]);
    expect(live.map((x) => x.id)).toEqual(['active', 'grace']);
  });

  it('orders retired keys newest first', () => {
    const { past } = partitionSiteKeys([
      k('a', 'revoked', '2026-02-01T00:00:00.000Z'),
      k('b', 'revoked', '2026-06-01T00:00:00.000Z'),
      k('c', 'revoked', '2026-04-01T00:00:00.000Z')
    ]);
    expect(past.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('survives a store with nothing but dead keys', () => {
    const { live, past } = partitionSiteKeys([k('x', 'revoked', '2026-01-01T00:00:00.000Z')]);
    expect(live).toEqual([]);
    expect(past).toHaveLength(1);
  });
});
