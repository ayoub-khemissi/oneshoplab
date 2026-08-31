/**
 * Where an audit takes its catalog from.
 *
 * Scraping a storefront that is already connected is worse than useless: the
 * scrape has no `sourceImageId`, and `syncProjectProducts` would write it
 * over the connection's rows — every precise image op silently degrades to
 * replace-all after the next audit (docs/api/IMAGE-OPS.md §1). So a project
 * with a live integration is scored from what the integration gave us.
 *
 * Pure on purpose: every input is gathered by the caller, so the rule is
 * unit-testable and reads as one table.
 */
import type { Platform, ShopConnectionStatus, ShopConnectionPlatform } from '@/shared/db/schema';

/**
 * A site key idle for 30 days means the plugin is gone (uninstalled, key
 * rotated away, merchant left): its catalog is no longer maintained, so we
 * go back to scraping. 30 d covers a merchant who audits monthly.
 */
export const SITE_KEY_ACTIVE_FOR_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Below this age the stored catalog is scored as-is. An audit is a
 * user-facing action; re-pulling a catalog synced minutes ago only adds
 * latency for identical data.
 */
export const CATALOG_FRESH_FOR_MS = 60 * 60 * 1000;
/** Older than this and the summary flags it so the UI can say how old it is. */
export const CATALOG_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type AuditDataSource = 'connection' | 'storefront';
/** Which integration owns the catalog — `site_key` = Integration API (the
 *  WooCommerce plugin today), refreshed through an outbound webhook. */
export type CatalogConnector = ShopConnectionPlatform | 'site_key';

export type AuditSourceReason =
  /** No project at all (public /audit run). */
  | 'anonymous'
  /** No connection and no live site key. */
  | 'no_connection'
  /** Connected, but nothing was ever synced — nothing to score. */
  | 'empty_catalog'
  | 'connected';

export interface AuditSourceInput {
  projectId: string | null;
  connection: {
    platform: ShopConnectionPlatform;
    status: ShopConnectionStatus;
    lastPullAt: Date | null;
  } | null;
  /** Most recent call from a live site key of this project. */
  siteKeyLastUsedAt: Date | null;
  /** Active products stored for the project. */
  catalogSize: number;
  /** Last sync that touched the stored catalog. */
  catalogSyncedAt: Date | null;
  /** Platform the stored rows came from (null on an empty catalog). */
  catalogPlatform: Platform | null;
  now: Date;
}

export interface AuditSourceDecision {
  source: AuditDataSource;
  reason: AuditSourceReason;
  /** The integration that owns the catalog. Set even on the `empty_catalog`
   *  fallback — it is the one we ask to fill the table. Null only when there
   *  is no integration at all. */
  connector: CatalogConnector | null;
  /** Platform to record on the audit row; 'unknown' lets detection decide. */
  platform: Platform;
  /** Ask the connector to push a fresh catalog before scoring. */
  requestRefresh: boolean;
  /** Catalog older than {@link CATALOG_STALE_AFTER_MS} — surfaced in the summary. */
  stale: boolean;
  catalogSyncedAt: Date | null;
}

const STOREFRONT = {
  source: 'storefront',
  connector: null,
  requestRefresh: false,
  stale: false
} as const;

export function decideAuditSource(input: AuditSourceInput): AuditSourceDecision {
  const base = { ...STOREFRONT, platform: 'unknown' as Platform, catalogSyncedAt: null };
  if (!input.projectId) return { ...base, reason: 'anonymous' };

  const connected = input.connection?.status === 'connected' ? input.connection : null;
  const siteKeyLive =
    input.siteKeyLastUsedAt != null &&
    input.now.getTime() - input.siteKeyLastUsedAt.getTime() < SITE_KEY_ACTIVE_FOR_MS;
  if (!connected && !siteKeyLive) return { ...base, reason: 'no_connection' };

  const connector: CatalogConnector = connected ? connected.platform : 'site_key';
  // A live connection is authoritative about the platform; a site key only
  // tells us the rows it synced, so we take the platform off the rows.
  const platform: Platform = connected ? connected.platform : (input.catalogPlatform ?? 'unknown');

  // Nothing was ever synced: there is no catalog to score. Scrape (so the
  // merchant still gets a report) and ask the connector to fill the table
  // for the next run — but do not wait for it.
  const syncedAt = latest(input.catalogSyncedAt, connected?.lastPullAt ?? null);
  if (input.catalogSize === 0) {
    return {
      ...STOREFRONT,
      reason: 'empty_catalog',
      connector,
      platform,
      requestRefresh: true,
      catalogSyncedAt: syncedAt
    };
  }

  const age = syncedAt ? input.now.getTime() - syncedAt.getTime() : Number.POSITIVE_INFINITY;
  return {
    source: 'connection',
    reason: 'connected',
    connector,
    platform,
    requestRefresh: age >= CATALOG_FRESH_FOR_MS,
    stale: age >= CATALOG_STALE_AFTER_MS,
    catalogSyncedAt: syncedAt
  };
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
