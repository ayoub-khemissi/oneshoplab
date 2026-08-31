/**
 * Audit source selection: score the catalog a live integration owns instead
 * of re-scraping the public storefront behind its back.
 *
 * The rule itself lives in `../lib/source-decision` (pure); this module does
 * the I/O — gather the signals, ask the connector for a refresh, wait a few
 * seconds at most, load the rows, score them.
 */
import { lastSiteKeyUseAt } from '@/entities/api-key';
import { audit } from '@/entities/audit';
import { emitProjectEvent } from '@/entities/outbound-webhook';
import { getCatalogState, loadProjectCatalog } from '@/entities/product';
import { getConnection, requestPull } from '@/entities/shop-connection';
import {
  decideAuditSource,
  type AuditSourceDecision,
  type CatalogConnector
} from '../lib/source-decision';
import { runAudit, type RunAuditResult } from './run';

/** Hard ceiling on how long an audit waits for the store to push a catalog.
 *  A merchant watching the progress page tolerates a few seconds; a store
 *  that never answers must not hold the audit at all. */
export const CATALOG_WAIT_TIMEOUT_MS = 20_000;
export const CATALOG_WAIT_POLL_MS = 1_000;

export interface CatalogWaitOptions {
  timeoutMs: number;
  pollMs: number;
}

export interface AuditRunOptions {
  maxProducts?: number;
  onProgress?: (fetched: number) => void;
  /** Tests shorten the bounded wait; production uses the constants above. */
  catalogWait?: Partial<CatalogWaitOptions>;
}

/** What an audit `summary` records about how it was produced. Additive:
 *  rows written before this existed have no `source`, and every reader
 *  treats a missing one as 'storefront'. */
export interface AuditSourceSummary {
  source: RunAuditResult['source'];
  sourceReason: RunAuditResult['sourceReason'];
  /** ISO string — the summary is JSON. */
  catalogSyncedAt: string | null;
  catalogStale: boolean;
}

export function auditSourceSummary(result: RunAuditResult): AuditSourceSummary {
  return {
    source: result.source,
    sourceReason: result.sourceReason,
    catalogSyncedAt: result.catalog?.syncedAt?.toISOString() ?? null,
    catalogStale: result.catalog?.stale ?? false
  };
}

/** The signals the decision needs, read in one place. */
export async function resolveAuditSource(
  projectId: string | null,
  now: Date = new Date()
): Promise<AuditSourceDecision> {
  if (!projectId) {
    return decideAuditSource({
      projectId: null,
      connection: null,
      siteKeyLastUsedAt: null,
      catalogSize: 0,
      catalogSyncedAt: null,
      catalogPlatform: null,
      now
    });
  }
  const [connection, siteKeyLastUsedAt, catalog] = await Promise.all([
    getConnection(projectId),
    lastSiteKeyUseAt(projectId, now),
    getCatalogState(projectId)
  ]);
  return decideAuditSource({
    projectId,
    connection: connection
      ? {
          platform: connection.platform,
          status: connection.status,
          lastPullAt: connection.lastPullAt
        }
      : null,
    siteKeyLastUsedAt,
    catalogSize: catalog.size,
    catalogSyncedAt: catalog.syncedAt,
    catalogPlatform: catalog.platform,
    now
  });
}

/**
 * Single entry point for "produce an audit result for this project".
 * Storefront path = the historical `runAudit`, untouched (anonymous audits
 * included). Connection path = score the stored catalog and return it with
 * `source: 'connection'`, which is the caller's signal NOT to sync the
 * products back (that would overwrite `sourceImageId` and everything else
 * the connection knows and the scrape does not).
 */
export async function runAuditForProject(
  projectId: string | null,
  url: string,
  options: AuditRunOptions = {}
): Promise<RunAuditResult> {
  const decision = await resolveAuditSource(projectId);
  if (decision.requestRefresh && projectId) {
    await requestCatalogRefresh(projectId, decision.connector);
  }

  if (decision.source === 'storefront' || !projectId) {
    const result = await runAudit(url, options);
    return { ...result, sourceReason: decision.reason };
  }

  if (decision.requestRefresh) {
    await waitForCatalogRefresh(projectId, decision.catalogSyncedAt, {
      timeoutMs: options.catalogWait?.timeoutMs ?? CATALOG_WAIT_TIMEOUT_MS,
      pollMs: options.catalogWait?.pollMs ?? CATALOG_WAIT_POLL_MS
    });
  }

  const fresh = await getCatalogState(projectId);
  const products = await loadProjectCatalog(projectId);
  // Defensive: the catalog was non-empty when we decided and empty now
  // (a full re-sync mid-flight archived everything). Scoring nothing would
  // publish a 0-product report, so fall back to the storefront.
  if (products.length === 0) {
    const result = await runAudit(url, options);
    return { ...result, sourceReason: 'empty_catalog' };
  }

  return {
    url,
    finalUrl: url,
    platform: decision.platform,
    // Not a guess: a live connection states its platform.
    detectionConfidence: 1,
    detectionSignals: [`connection:${decision.connector}`],
    productsFetched: products.length,
    truncated: false,
    products,
    report: audit(products),
    error: null,
    source: 'connection',
    sourceReason: decision.reason,
    catalog: {
      syncedAt: fresh.syncedAt ?? decision.catalogSyncedAt,
      stale: decision.stale,
      refreshRequested: decision.requestRefresh
    }
  };
}

/**
 * Ask the store to push its catalog now. Best effort by contract — a store
 * that is down, a webhook receiver that 500s, must never fail the audit.
 */
async function requestCatalogRefresh(
  projectId: string,
  connector: CatalogConnector | null
): Promise<void> {
  try {
    if (connector === 'shopify' || connector === 'wix') {
      // Entity-level: `requestPull` is what both connectors' own
      // "Synchroniser" actions call, and a feature cannot import a feature.
      await requestPull(projectId);
      return;
    }
    if (connector === 'site_key') {
      // Integration API (WooCommerce plugin ≥ 1.1): the plugin owns the write
      // path, so we can only ask. Plugins registered before `sync.requested`
      // existed are not subscribed to it and simply never hear the ask.
      await emitProjectEvent(projectId, 'sync.requested', {
        reason: 'audit',
        requestedAt: new Date().toISOString()
      });
    }
  } catch (e) {
    console.error('[audit] catalog refresh request failed', projectId, e);
  }
}

/** Poll the sync marker until it moves past `since`, or give up. */
async function waitForCatalogRefresh(
  projectId: string,
  since: Date | null,
  wait: CatalogWaitOptions
): Promise<boolean> {
  const deadline = Date.now() + wait.timeoutMs;
  const from = since?.getTime() ?? 0;
  while (Date.now() < deadline) {
    await sleep(Math.min(wait.pollMs, Math.max(0, deadline - Date.now())));
    const state = await getCatalogState(projectId);
    if (state.syncedAt && state.syncedAt.getTime() > from) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
