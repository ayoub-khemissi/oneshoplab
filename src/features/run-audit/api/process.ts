import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/shared/db';
import { audits, projects } from '@/shared/db/schema';
import { notify } from '@/entities/notification';
import { auditSourceSummary, runAuditForProject, type AuditRunOptions } from './catalog-audit';
import { syncProjectProducts } from '@/entities/product';

export interface ProcessAuditOptions {
  /** Bounded wait for a connected store to push a fresh catalog. */
  catalogWait?: AuditRunOptions['catalogWait'];
}

/**
 * Process a pending audit row:
 *   1. Get the catalog — from the connected store when the project has a
 *      live integration, else by detecting the platform and scraping the
 *      public storefront — and compute the static rule-based report
 *      (scores, distribution, worst/best/latest products).
 *   2. Run the AI dynamic audit on the 3 most recently posted products:
 *      one Claude chat each (sync) for SEO rewrite + Instagram post,
 *      plus three image-to-image generations each (async via webhook).
 *   3. Persist the audit row as `completed`.
 *
 * Idempotent against double runs — only acts when the row is `pending`.
 */
export async function processAudit(
  auditId: string,
  options: ProcessAuditOptions = {}
): Promise<void> {
  const row = await db.query.audits.findFirst({ where: eq(audits.id, auditId) });
  if (!row || row.status !== 'pending') return;

  await db
    .update(audits)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(audits.id, auditId));

  try {
    const result = await runAuditForProject(row.projectId, row.url, {
      maxProducts: 10000,
      catalogWait: options.catalogWait
    });
    const isFailure = !result.report && result.error;

    // 3-way merge: refresh metadata on existing products (title rename,
    // desc edits, new images), insert anything new, soft-archive what
    // disappeared from the scrape. Custom instructions + AI-generation
    // jobs are preserved across the sync so a re-audit never destroys
    // the merchant's prior work.
    //
    // Scrapes only. When the products came from the connected store they
    // ARE the table: writing them back is at best a no-op and at worst
    // destroys what only the connection knows (`sourceImageId`), which
    // silently degrades every later image op to replace-all.
    if (row.projectId && result.source === 'storefront' && result.products.length > 0) {
      await syncProjectProducts(row.projectId, result.platform, result.products);
    }

    // Backfill the project's platform + URL from the audit. A project
    // created from the dashboard "add site" flow (launchAuditForUser) is
    // inserted before anything is known about the store, so it starts as
    // source='unknown' with no url — and nothing used to promote it once
    // detection ran, leaving real Shopify/Woo/Wix stores labelled
    // "unknown" forever (breaks platform-specific UI and sync). Only
    // promote from 'unknown' so a manual project or a prior detection is
    // never overwritten.
    if (row.projectId && result.platform !== 'unknown') {
      await db
        .update(projects)
        .set({ source: result.platform, url: sql`COALESCE(${projects.url}, ${row.url})` })
        .where(and(eq(projects.id, row.projectId), eq(projects.source, 'unknown')));
    }

    await db
      .update(audits)
      .set({
        status: isFailure ? 'failed' : 'completed',
        platform: result.platform,
        scores: result.report ? result.report.scores : null,
        summary: result.report
          ? {
              avgProductScore: result.report.avgProductScore,
              averages: result.report.averages,
              lastProductUpdated: result.report.lastProductUpdated,
              lowResImageCount: result.report.lowResImageCount,
              distribution: result.report.distribution,
              topVendors: result.report.topVendors,
              topProductTypes: result.report.topProductTypes,
              topTags: result.report.topTags,
              worstProducts: result.report.worstProducts,
              bestProducts: result.report.bestProducts,
              latestProducts: result.report.latestProducts,
              allProducts: result.report.allProducts,
              detectedLanguage: result.report.detectedLanguage,
              detectionSignals: result.detectionSignals,
              detectionConfidence: result.detectionConfidence,
              ...auditSourceSummary(result)
            }
          : null,
        productsSampled: result.productsFetched,
        error: result.error,
        completedAt: new Date()
      })
      .where(eq(audits.id, auditId));

    await emitAuditNotification(
      row.projectId,
      auditId,
      isFailure ? 'audit_failed' : 'audit_completed',
      row.domain,
      result.report?.scores?.overall ?? null,
      isFailure ? (result.error ?? null) : null
    );
  } catch (e) {
    await db
      .update(audits)
      .set({
        status: 'failed',
        error: (e as Error).message,
        completedAt: new Date()
      })
      .where(eq(audits.id, auditId));

    await emitAuditNotification(
      row.projectId,
      auditId,
      'audit_failed',
      row.domain,
      null,
      (e as Error).message
    );
  }
}

/** Resolve the user that owns the audit's project and log the outcome.
 *  Anonymous audits (no project) emit no notification — there's no
 *  owner to surface them to. The merchant typically isn't watching
 *  the in-progress audit page when the run completes (audits take
 *  ~30-90s and are usually fired-and-forgotten), so isRead=false
 *  ticks the badge up; if they happen to be on the page, the
 *  AutoRefresh poller flips it visible. */
async function emitAuditNotification(
  projectId: string | null,
  auditId: string,
  kind: 'audit_completed' | 'audit_failed',
  domain: string,
  scoreOverall: number | null,
  errorMessage: string | null
): Promise<void> {
  if (!projectId) return;
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { userId: true }
  });
  if (!project?.userId) return;
  const payload: Record<string, unknown> = { domain };
  if (kind === 'audit_completed' && scoreOverall != null) payload.score = scoreOverall;
  if (kind === 'audit_failed' && errorMessage) payload.errorMessage = errorMessage;
  await notify({
    userId: project.userId,
    kind,
    auditId,
    projectId,
    payload
  });
}
