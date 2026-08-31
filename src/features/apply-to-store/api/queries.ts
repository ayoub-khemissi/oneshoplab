import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { db } from '@/shared/db';
import { productChanges, products, projects } from '@/shared/db/schema';
import {
  addCounts,
  buildPendingDetail,
  countPending,
  dropSuperseded
} from '../lib/pending-summary';
import { toChangeSummary } from '../lib/summary';
import type {
  ChangeSummary,
  PendingChangeItem,
  PendingChangeStatus,
  PendingChangeSummary,
  PendingSiteCount,
  PendingSummary,
  PendingUserSummary
} from '../model/types';

const PENDING_LIST_LIMIT = 100;

/** The three statuses a merchant still has to act on (see PendingChangeStatus). */
const OPEN_STATUSES: readonly PendingChangeStatus[] = ['pending', 'conflict', 'failed'];

/** A failure nobody ever dismissed stops nagging on its own after this long. */
const STALE_FAILURE_DAYS = 30;

/**
 * "Still worth showing the merchant": an open status, not dismissed by hand,
 * and — for a failure or a conflict — not older than STALE_FAILURE_DAYS. A
 * `pending` row never goes stale: it is still queued for the store. The rows
 * themselves stay in the table either way, so support keeps the ack payload.
 */
function stillOpen() {
  const cutoff = new Date(Date.now() - STALE_FAILURE_DAYS * 24 * 60 * 60 * 1000);
  return and(
    inArray(productChanges.status, [...OPEN_STATUSES]),
    isNull(productChanges.dismissedAt),
    or(eq(productChanges.status, 'pending'), gt(productChanges.approvedAt, cutoff))
  );
}

/** Latest change per source job — drives the Apply button state on the product page. */
export async function listChangesForJobs(
  projectId: string,
  jobIds: string[]
): Promise<Record<string, ChangeSummary>> {
  if (jobIds.length === 0) return {};
  const rows = await db
    .select()
    .from(productChanges)
    .where(
      and(eq(productChanges.projectId, projectId), inArray(productChanges.sourceJobId, jobIds))
    )
    .orderBy(desc(productChanges.id));
  const out: Record<string, ChangeSummary> = {};
  for (const row of rows) {
    if (row.sourceJobId && !(row.sourceJobId in out)) out[row.sourceJobId] = toChangeSummary(row);
  }
  return out;
}

/** Integrations tab: what the plugin still has to pick up, plus conflicts to review. */
export async function listPendingChangesForSite(
  projectId: string
): Promise<PendingChangeSummary[]> {
  const rows = await db
    .select({ change: productChanges, productTitle: products.title })
    .from(productChanges)
    .innerJoin(products, eq(products.id, productChanges.productId))
    .where(and(eq(productChanges.projectId, projectId), stillOpen()))
    .orderBy(desc(productChanges.id))
    .limit(PENDING_LIST_LIMIT);
  return rows.map((r) => ({
    ...toChangeSummary(r.change),
    productId: r.change.productId,
    productTitle: r.productTitle,
    field: r.change.field
  }));
}

// ============================================================================
// "Changes waiting for your store" — banner counters + modal rows
// ============================================================================

type ChangeRow = typeof productChanges.$inferSelect;

function toItem(change: ChangeRow, productTitle: string): PendingChangeItem {
  return {
    id: change.id,
    projectId: change.projectId,
    productId: change.productId,
    productTitle,
    field: change.field,
    status: change.status as PendingChangeStatus,
    approvedAtIso: change.approvedAt.toISOString(),
    error: change.ackPayload?.error ?? null,
    retryable: change.sourceJobId !== null,
    detail: buildPendingDetail(change.field, change.value, change.priorValue)
  };
}

const itemColumns = {
  change: productChanges,
  productTitle: products.title
};

/** Newest-first rows → the modal's items, minus the ones already re-sent. */
function toItems(rows: Array<{ change: ChangeRow; productTitle: string }>): PendingChangeItem[] {
  return dropSuperseded(rows.map((r) => toItem(r.change, r.productTitle)));
}

/** Newest first: the modal reads as "what just happened", not as a backlog. */
export async function listPendingSummaryForSite(
  projectId: string,
  userId: string
): Promise<PendingSummary> {
  const rows = await db
    .select(itemColumns)
    .from(productChanges)
    .innerJoin(products, eq(products.id, productChanges.productId))
    .innerJoin(projects, eq(projects.id, productChanges.projectId))
    .where(and(eq(productChanges.projectId, projectId), eq(projects.userId, userId), stillOpen()))
    .orderBy(desc(productChanges.id))
    .limit(PENDING_LIST_LIMIT);
  const items = toItems(rows);
  return { counts: countPending(items), items };
}

/** The product page's own banner — one product, its owner only. */
export async function listPendingSummaryForProduct(
  productId: string,
  userId: string
): Promise<PendingSummary> {
  const rows = await db
    .select(itemColumns)
    .from(productChanges)
    .innerJoin(products, eq(products.id, productChanges.productId))
    .innerJoin(projects, eq(projects.id, productChanges.projectId))
    .where(and(eq(productChanges.productId, productId), eq(projects.userId, userId), stillOpen()))
    .orderBy(desc(productChanges.id))
    .limit(PENDING_LIST_LIMIT);
  const items = toItems(rows);
  return { counts: countPending(items), items };
}

/**
 * One grouped aggregate for every store of the account — what the dashboard
 * home puts on each site card. Not a SQL GROUP BY: the same "already re-sent"
 * rule as the modal has to run over the rows, or a card would count a failure
 * the list no longer shows. The open set is small — they get applied.
 */
export async function countPendingByProject(userId: string): Promise<PendingSiteCount[]> {
  const rows = await db
    .select({
      projectId: productChanges.projectId,
      projectName: projects.name,
      productId: productChanges.productId,
      field: productChanges.field,
      status: productChanges.status
    })
    .from(productChanges)
    .innerJoin(projects, eq(projects.id, productChanges.projectId))
    .where(and(eq(projects.userId, userId), stillOpen()))
    .orderBy(desc(productChanges.id));

  const bySite = new Map<string, PendingSiteCount>();
  for (const row of dropSuperseded(
    rows.map((r) => ({ ...r, status: r.status as PendingChangeStatus }))
  )) {
    const entry = bySite.get(row.projectId) ?? {
      projectId: row.projectId,
      projectName: row.projectName,
      total: 0,
      pending: 0,
      conflict: 0,
      failed: 0
    };
    entry.total += 1;
    entry[row.status] += 1;
    bySite.set(row.projectId, entry);
  }
  return [...bySite.values()];
}

/** Account-wide recap: the per-site counters plus the newest rows for a modal. */
export async function listPendingSummaryForUser(userId: string): Promise<PendingUserSummary> {
  const [sites, rows] = await Promise.all([
    countPendingByProject(userId),
    db
      .select(itemColumns)
      .from(productChanges)
      .innerJoin(products, eq(products.id, productChanges.productId))
      .innerJoin(projects, eq(projects.id, productChanges.projectId))
      .where(and(eq(projects.userId, userId), stillOpen()))
      .orderBy(desc(productChanges.id))
      .limit(PENDING_LIST_LIMIT)
  ]);
  const items = toItems(rows);
  const counts = sites.reduce(addCounts, { total: 0, pending: 0, conflict: 0, failed: 0 });
  return { counts, items, sites };
}
