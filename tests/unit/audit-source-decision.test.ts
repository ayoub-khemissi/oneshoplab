/**
 * Which catalog an audit scores. Getting this wrong is expensive: scraping a
 * connected store overwrites the rows the integration owns (and their
 * `sourceImageId`), so the rule is pinned here.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOG_FRESH_FOR_MS,
  CATALOG_STALE_AFTER_MS,
  SITE_KEY_ACTIVE_FOR_MS,
  decideAuditSource,
  type AuditSourceInput
} from '@/features/run-audit/lib/source-decision';

const NOW = new Date('2026-08-31T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function input(over: Partial<AuditSourceInput> = {}): AuditSourceInput {
  return {
    projectId: 'proj-1',
    connection: null,
    siteKeyLastUsedAt: null,
    catalogSize: 0,
    catalogSyncedAt: null,
    catalogPlatform: null,
    now: NOW,
    ...over
  };
}

const connection = (over: Partial<NonNullable<AuditSourceInput['connection']>> = {}) => ({
  platform: 'shopify' as const,
  status: 'connected' as const,
  lastPullAt: ago(5 * MINUTE),
  ...over
});

describe('decideAuditSource', () => {
  it('scrapes for an anonymous audit (no project)', () => {
    expect(decideAuditSource(input({ projectId: null }))).toMatchObject({
      source: 'storefront',
      reason: 'anonymous',
      connector: null,
      requestRefresh: false
    });
  });

  it('scrapes when the project has no connection and no live site key', () => {
    expect(decideAuditSource(input({ catalogSize: 12 }))).toMatchObject({
      source: 'storefront',
      reason: 'no_connection'
    });
  });

  it('scores the stored catalog of a connected store, no refresh when fresh', () => {
    const d = decideAuditSource(
      input({
        connection: connection(),
        catalogSize: 12,
        catalogSyncedAt: ago(4 * MINUTE),
        catalogPlatform: 'shopify'
      })
    );
    expect(d).toMatchObject({
      source: 'connection',
      reason: 'connected',
      connector: 'shopify',
      platform: 'shopify',
      requestRefresh: false,
      stale: false
    });
    expect(d.catalogSyncedAt).toEqual(ago(4 * MINUTE));
  });

  it('takes the platform from the connection, not from the stored rows', () => {
    expect(
      decideAuditSource(
        input({
          connection: connection({ platform: 'wix' }),
          catalogSize: 3,
          catalogSyncedAt: ago(MINUTE),
          catalogPlatform: 'shopify'
        })
      )
    ).toMatchObject({ platform: 'wix', connector: 'wix' });
  });

  it('asks for a refresh past the freshness window, and flags a stale catalog', () => {
    const barelyStale = decideAuditSource(
      input({
        connection: connection({ lastPullAt: null }),
        catalogSize: 5,
        catalogSyncedAt: ago(CATALOG_FRESH_FOR_MS + MINUTE),
        catalogPlatform: 'shopify'
      })
    );
    expect(barelyStale).toMatchObject({
      source: 'connection',
      requestRefresh: true,
      stale: false
    });

    const veryStale = decideAuditSource(
      input({
        connection: connection({ lastPullAt: null }),
        catalogSize: 5,
        catalogSyncedAt: ago(CATALOG_STALE_AFTER_MS + DAY),
        catalogPlatform: 'shopify'
      })
    );
    expect(veryStale).toMatchObject({ source: 'connection', requestRefresh: true, stale: true });
  });

  it('takes the most recent of the connection pull and the stored rows as the sync date', () => {
    const d = decideAuditSource(
      input({
        connection: connection({ lastPullAt: ago(2 * MINUTE) }),
        catalogSize: 5,
        catalogSyncedAt: ago(3 * DAY),
        catalogPlatform: 'shopify'
      })
    );
    expect(d.catalogSyncedAt).toEqual(ago(2 * MINUTE));
    expect(d.requestRefresh).toBe(false);
  });

  it('falls back to scraping when the connection never synced anything', () => {
    expect(
      decideAuditSource(input({ connection: connection({ lastPullAt: null }), catalogSize: 0 }))
    ).toMatchObject({
      source: 'storefront',
      reason: 'empty_catalog',
      // Still ask (the connector is kept for exactly that), so the next
      // audit has a catalog to score.
      requestRefresh: true,
      connector: 'shopify',
      platform: 'shopify'
    });
  });

  it('ignores a connection that is not connected', () => {
    expect(
      decideAuditSource(
        input({
          connection: connection({ status: 'token_invalid' }),
          catalogSize: 9,
          catalogSyncedAt: ago(MINUTE)
        })
      )
    ).toMatchObject({ source: 'storefront', reason: 'no_connection' });
  });

  it('treats a recently used site key as a live integration', () => {
    expect(
      decideAuditSource(
        input({
          siteKeyLastUsedAt: ago(2 * DAY),
          catalogSize: 40,
          catalogSyncedAt: ago(2 * DAY),
          catalogPlatform: 'woocommerce'
        })
      )
    ).toMatchObject({
      source: 'connection',
      connector: 'site_key',
      platform: 'woocommerce',
      requestRefresh: true
    });
  });

  it('goes back to scraping once the site key has been idle too long', () => {
    expect(
      decideAuditSource(
        input({
          siteKeyLastUsedAt: ago(SITE_KEY_ACTIVE_FOR_MS + DAY),
          catalogSize: 40,
          catalogSyncedAt: ago(SITE_KEY_ACTIVE_FOR_MS + DAY),
          catalogPlatform: 'woocommerce'
        })
      )
    ).toMatchObject({ source: 'storefront', reason: 'no_connection' });
  });

  it('refreshes a catalog with no known sync date at all', () => {
    expect(
      decideAuditSource(
        input({
          siteKeyLastUsedAt: ago(HOUR),
          catalogSize: 7,
          catalogSyncedAt: null,
          catalogPlatform: 'woocommerce'
        })
      )
    ).toMatchObject({ source: 'connection', requestRefresh: true, stale: true });
  });
});
