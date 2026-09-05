/**
 * The window between connecting a store and its catalogue landing. The rule
 * has to close on its own: a banner that says "fetching…" forever is worse
 * than no banner at all, and that is exactly what the first version did.
 */
import { describe, expect, it } from 'vitest';
import {
  isCatalogArriving,
  type CatalogArrivalInput
} from '@/features/run-audit/lib/catalog-arrival';

const T1 = new Date('2026-09-05T06:22:36Z');

function connected(over: Partial<NonNullable<CatalogArrivalInput['connection']>> = {}) {
  return {
    status: 'connected',
    pullPhase: 'done',
    pullRequestedAt: null,
    lastPullAt: T1,
    ...over
  };
}

describe('isCatalogArriving', () => {
  it('is true while a pull is queued, running, or has never happened', () => {
    expect(
      isCatalogArriving({ connection: connected({ pullRequestedAt: T1, lastPullAt: null }) })
    ).toBe(true);
    expect(isCatalogArriving({ connection: connected({ pullPhase: 'running' }) })).toBe(true);
    expect(isCatalogArriving({ connection: connected({ lastPullAt: null }) })).toBe(true);
  });

  it('closes as soon as the catalogue has landed', () => {
    expect(isCatalogArriving({ connection: connected() })).toBe(false);
  });

  it('closes even though an audit ran BEFORE the last pull', () => {
    // The trap the first version fell into: an audit asks the store for a
    // fresh catalogue while it runs, so the pull it triggers is always stamped
    // after the audit that caused it. Comparing the two meant the banner could
    // never come down. Only the connection's own state decides now.
    expect(isCatalogArriving({ connection: connected({ lastPullAt: new Date() }) })).toBe(false);
  });

  it('a failed pull is not "on its way"', () => {
    // The connection card reports the failure; a spinner here would never end.
    expect(
      isCatalogArriving({ connection: connected({ pullPhase: 'failed', lastPullAt: null }) })
    ).toBe(false);
  });

  it('says nothing about a project with no connector, or a dead one', () => {
    expect(isCatalogArriving({ connection: null })).toBe(false);
    expect(isCatalogArriving({ connection: connected({ status: 'revoked' }) })).toBe(false);
  });
});
