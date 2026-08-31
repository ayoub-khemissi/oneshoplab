'use server';

import { and, eq, gte, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AUDIT_RATE_LIMIT_WINDOW_MS, auditRateLimitForPlan } from '@/entities/ai-model';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { audits, projects } from '@/shared/db/schema';
import { launchAuditForUser } from './launch';
import { refreshAuditProducts } from './refresh';

/**
 * Manually relaunch the static audit on a project. Throttled per-plan
 * (see auditCooldownMsForPlan) to keep scraping costs bounded — the UI
 * button computes its own cooldown so this is mostly a defensive check.
 * Latest-audit createdAt is the cooldown anchor.
 */
export async function relaunchProjectAuditAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const projectId = String(formData.get('projectId') ?? '');
  if (!projectId) return;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.user.id))
  });
  if (!project) return;

  // Use the two-step lookup so the multi-MB `summary` JSON never
  // hits MySQL's sort buffer. Only url / domain are needed below.
  const { findLatestAuditIdWhere } = await import('@/entities/audit');
  const latestId = await findLatestAuditIdWhere(eq(audits.projectId, project.id));
  const latest = latestId
    ? await db.query.audits.findFirst({
        where: eq(audits.id, latestId),
        columns: { url: true, domain: true }
      })
    : null;

  // Rate-limit gate: count the user's audits launched across ALL their
  // projects in the last 24h. Failed/timed_out runs don't count (a bad
  // first run shouldn't lock the merchant out for a day). Limit equals
  // the plan's site quota (1/3/10/50 for Free/Starter/Pro/Scale). This
  // is enforced server-side regardless of the UI's own gating.
  const userProjectIds = await db.query.projects.findMany({
    where: eq(projects.userId, session.user.id),
    columns: { id: true }
  });
  const ids = userProjectIds.map((p) => p.id);
  const limit = auditRateLimitForPlan(session.user.plan);
  if (ids.length > 0) {
    const since = new Date(Date.now() - AUDIT_RATE_LIMIT_WINDOW_MS);
    const inWindow = await db.query.audits.findMany({
      where: and(
        inArray(audits.projectId, ids),
        gte(audits.createdAt, since),
        inArray(audits.status, ['pending', 'running', 'completed'])
      ),
      columns: { id: true }
    });
    if (inWindow.length >= limit) return;
  }

  // Prefer the latest audit's URL (always populated) — projects.url may be
  // null for older rows that pre-date that column.
  const url = latest?.url ?? project.url ?? null;
  const domain = project.domain ?? latest?.domain ?? null;
  if (!url || !domain) return;

  await launchAuditForUser(session.user.id, { url, domain });

  revalidatePath(`/dashboard/sites/${projectId}`);
}

/**
 * Manually re-read the catalog of the user's project to refresh product data
 * without burning AI credits — from the connected store when there is one
 * (which may wait a few seconds for it to push), else a re-scrape. Verifies
 * ownership before running.
 */
export async function refreshProjectAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const projectId = String(formData.get('projectId') ?? '');
  if (!projectId) return;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.user.id))
  });
  if (!project) return;

  // Manual refresh — runs regardless of freshness.
  const { findLatestAuditIdWhere } = await import('@/entities/audit');
  const latestId = await findLatestAuditIdWhere(eq(audits.projectId, project.id));
  if (latestId) {
    await refreshAuditProducts(latestId);
  }
  revalidatePath('/dashboard');
}
