import { and, desc, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { touchProjectLastView } from '@/lib/projects/touch-last-view';
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

  // (userId, domain) is the identity. If the user already has a
  // manual project for this domain, never run a scrape on it — a
  // failing scrape audit would supersede the recomputed manual
  // overview when the dashboard picks the latest audit by
  // createdAt. Just hand the user back to their existing manual
  // project page. (The UI hides the Relaunch button on manual sites
  // so this is mostly defensive against direct URL flows.)
  if (project?.source === 'manual') {
    return { projectId: project.id };
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

/** A recent completed anon audit for the same domain is reused instead of
 *  re-scraping. Dual purpose: it dedupes a hammering bot on the public
 *  /audit form, and gives an instant result for an already-seen
 *  store. 24h matches AUDIT_FRESH_FOR_MS — long enough to rate-limit,
 *  short enough that the teaser score isn't embarrassingly stale. */
const ANON_AUDIT_REUSE_MS = 24 * 60 * 60 * 1000;

/**
 * Anonymous counterpart to {@link launchAuditForUser}: no user, no
 * project, no credit gate. The audit row carries an `anonToken` (read
 * back by the public /audit result page) instead of a
 * `projectId`. `processAudit` detects the `anonToken` and skips the
 * paid AI dynamic sub-audit, so an anon run is scrape + rule-based
 * score only — zero credits, no AI-generation abuse surface. Going
 * further (the AI rewrites) is what requires signing up.
 */
export async function launchAnonymousAudit(norm: {
  url: string;
  domain: string;
}): Promise<{ token: string }> {
  const cutoff = new Date(Date.now() - ANON_AUDIT_REUSE_MS);
  const recent = await db.query.audits.findFirst({
    where: and(
      isNull(audits.projectId),
      isNotNull(audits.anonToken),
      eq(audits.domain, norm.domain),
      eq(audits.status, 'completed'),
      gt(audits.createdAt, cutoff)
    ),
    orderBy: [desc(audits.createdAt)]
  });
  if (recent?.anonToken) return { token: recent.anonToken };

  const token = randomUUID();
  const id = randomUUID();
  await db.insert(audits).values({
    id,
    url: norm.url,
    domain: norm.domain,
    projectId: null,
    anonToken: token,
    status: 'pending'
  });

  void processAudit(id).catch((e) => {
    console.error(`[anon-audit ${id}] background processing crashed`, e);
  });

  return { token };
}
