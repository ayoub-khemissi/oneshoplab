import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { touchProjectLastView } from '@/lib/auth-actions';
import { db } from '@/lib/db';
import { audits, projects } from '@/lib/db/schema';
import { processAudit } from './process';

/** Minimum credit balance required to launch an audit (one full dynamic
 *  audit across 3 products consumes ~150 credits at default settings). */
export const MIN_AUDIT_CREDITS = 50;

/**
 * Parse a free-form URL into a canonical { url, domain } pair. Returns null
 * if the input doesn't look like a valid hostname. Used by every audit-launch
 * surface — landing page hero, "Add site" page — to ensure a single source
 * of truth for what counts as a launchable URL.
 */
export function normalizeUrl(input: string): { url: string; domain: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (!u.hostname.includes('.')) return null;
    return { url: `${u.protocol}//${u.hostname}`, domain: u.hostname };
  } catch {
    return null;
  }
}

/**
 * Core audit-launch logic: ensure project, insert audit row, fire background
 * processing. Returns the projectId so callers can redirect to the per-site
 * page. Re-runs on the same domain reuse the existing project (no new
 * project created), so this doesn't bump the user's quota.
 */
export async function launchAuditForUser(
  userId: string,
  norm: { url: string; domain: string }
): Promise<{ projectId: string | null }> {
  let project = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.domain, norm.domain))
  });
  if (!project) {
    const projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      userId,
      name: norm.domain,
      domain: norm.domain
    });
    project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  }

  const id = randomUUID();
  await db.insert(audits).values({
    id,
    url: norm.url,
    domain: norm.domain,
    projectId: project?.id ?? null,
    status: 'pending'
  });

  if (project?.id) {
    await touchProjectLastView(project.id);
  }

  void processAudit(id).catch((e) => {
    console.error(`[audit ${id}] background processing crashed`, e);
  });

  return { projectId: project?.id ?? null };
}
