import { and, desc, eq, isNotNull, max } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { findLatestAuditIdWhere } from '@/entities/audit';
import { db } from '@/shared/db';
import { audits, catalogSyncSessions, projects, shopConnections } from '@/shared/db/schema';
import { processAudit } from './process';

/** Stores audited per pass — bounds a tick when several connect at once. */
const MAX_PER_PASS = 3;
/** Candidates read before narrowing; a store settles after one audit. */
const CANDIDATE_LIMIT = MAX_PER_PASS * 20;

interface Candidate {
  projectId: string;
  /** When the store last handed us its catalog. */
  catalogAt: Date;
}

/**
 * Audit a store whose catalog arrived after its audit had failed.
 *
 * The funnel sends a merchant whose storefront couldn't be detected straight to
 * "connect your store" — but connecting only pulled the catalog, it never
 * re-ran the audit. The dashboard reads the latest audit by `createdAt`, so the
 * merchant connected successfully, watched their products arrive, and kept
 * reading "Audit échoué : platform not detected" next to them. Found in staging
 * QA 2026-09-04 on a Shopify OAuth install.
 *
 * Two conditions, and the pair is what makes this self-limiting:
 *   - the latest audit is not `completed` — a store that already has a report
 *     is left alone (`rescoreProjectsWithAppliedChanges` keeps that one fresh);
 *   - the catalog is newer than that audit — so a run that fails again is not
 *     retried on the next tick. A later sync moves the catalog forward and
 *     buys exactly one more attempt, which is what a merchant fixing their
 *     store expects.
 *
 * Free: a connected store is scored from its stored catalog, never re-scraped,
 * and the audit spends no credits.
 */
export async function auditProjectsWithSyncedCatalog(): Promise<number> {
  const candidates = await collectCandidates();

  let launched = 0;
  for (const candidate of candidates) {
    if (launched >= MAX_PER_PASS) break;
    if (await auditProjectIfCatalogIsNewer(candidate)) launched += 1;
  }
  if (launched > 0) console.info(`[audit-after-sync] launched ${launched} audit(s)`);
  return launched;
}

/** Connector pulls (Shopify, Wix) and plugin-pushed syncs (site key). */
async function collectCandidates(): Promise<Candidate[]> {
  const [pulls, sessions] = await Promise.all([
    db
      .select({ projectId: shopConnections.projectId, catalogAt: shopConnections.lastPullAt })
      .from(shopConnections)
      .where(and(eq(shopConnections.status, 'connected'), isNotNull(shopConnections.lastPullAt)))
      .orderBy(desc(shopConnections.lastPullAt))
      .limit(CANDIDATE_LIMIT),
    db
      .select({
        projectId: catalogSyncSessions.projectId,
        catalogAt: max(catalogSyncSessions.closedAt)
      })
      .from(catalogSyncSessions)
      .where(isNotNull(catalogSyncSessions.closedAt))
      .groupBy(catalogSyncSessions.projectId)
      .orderBy(desc(max(catalogSyncSessions.closedAt)))
      .limit(CANDIDATE_LIMIT)
  ]);

  // One store can have both a connection and plugin sessions; keep its most
  // recent catalog so the "newer than the audit" test uses the real one.
  const newest = new Map<string, Date>();
  for (const row of [...pulls, ...sessions]) {
    if (!row.catalogAt) continue;
    const previous = newest.get(row.projectId);
    if (!previous || row.catalogAt > previous) newest.set(row.projectId, row.catalogAt);
  }
  return [...newest].map(([projectId, catalogAt]) => ({ projectId, catalogAt }));
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function auditProjectIfCatalogIsNewer(candidate: Candidate): Promise<boolean> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, candidate.projectId),
    columns: { id: true, source: true, url: true, domain: true }
  });
  // A manual catalog has no store to audit, and `launchAuditForUser` refuses
  // one for the same reason.
  if (!project || project.source === 'manual') return false;

  const latestId = await findLatestAuditIdWhere(eq(audits.projectId, project.id));
  if (latestId) {
    const [latest] = await db
      .select({ status: audits.status, createdAt: audits.createdAt })
      .from(audits)
      .where(eq(audits.id, latestId));
    if (!latest || latest.status === 'completed') return false;
    // Already tried since this catalog landed: don't loop on a store that
    // fails for its own reasons.
    if (latest.createdAt >= candidate.catalogAt) return false;
  }

  // `url` is unused on the connection path (the stored catalog is scored), but
  // both columns are NOT NULL on `audits` while a project created from "add
  // site" carries neither until an audit backfills them.
  const domain = project.domain ?? hostOf(project.url);
  if (!domain) return false;

  const id = randomUUID();
  await db.insert(audits).values({
    id,
    url: project.url ?? `https://${domain}`,
    domain,
    projectId: project.id,
    status: 'pending'
  });
  await processAudit(id);
  return true;
}
