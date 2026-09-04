/**
 * The window between connecting a store and its first score. Everything is
 * fine there and nothing looks it, so the page has to be told when to say
 * "fetching your catalog" instead of rendering an audit that predates the
 * connection.
 */
import { describe, expect, it } from 'vitest';
import {
  isCatalogArriving,
  type CatalogArrivalInput
} from '@/features/run-audit/lib/catalog-arrival';

const T0 = new Date('2026-09-04T12:23:05Z'); // the audit that failed
const T1 = new Date('2026-09-04T12:24:11Z'); // the catalog landed
const T2 = new Date('2026-09-04T12:26:05Z'); // it finally got scored

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
  it('covers the real production gap: catalog in, audit still the old failure', () => {
    expect(
      isCatalogArriving({
        connection: connected(),
        audit: { status: 'failed', createdAt: T0 }
      })
    ).toBe(true);
  });

  it('ends as soon as an audit has scored that catalog', () => {
    expect(
      isCatalogArriving({
        connection: connected(),
        audit: { status: 'completed', createdAt: T2 }
      })
    ).toBe(false);
  });

  it('a completed audit older than the catalog does not describe it', () => {
    expect(
      isCatalogArriving({
        connection: connected({ lastPullAt: T2 }),
        audit: { status: 'completed', createdAt: T1 }
      })
    ).toBe(true);
  });

  it('is true while a pull is queued or running', () => {
    expect(
      isCatalogArriving({
        connection: connected({ pullRequestedAt: T1, lastPullAt: null }),
        audit: null
      })
    ).toBe(true);
    expect(
      isCatalogArriving({
        connection: connected({ pullPhase: 'running' }),
        audit: { status: 'completed', createdAt: T2 }
      })
    ).toBe(true);
  });

  it('says nothing about a project with no connector, or a dead one', () => {
    expect(
      isCatalogArriving({ connection: null, audit: { status: 'failed', createdAt: T0 } })
    ).toBe(false);
    // A revoked connection is not fetching anything: the merchant must see the
    // real state, not a spinner that never resolves.
    expect(
      isCatalogArriving({
        connection: connected({ status: 'revoked' }),
        audit: { status: 'failed', createdAt: T0 }
      })
    ).toBe(false);
  });
});
