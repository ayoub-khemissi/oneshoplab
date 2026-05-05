'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auditCooldownMsForPlan, MAX_CUSTOM_INSTRUCTIONS_CHARS } from './ai/models';
import { launchAuditForUser } from './audit/launch';
import { refreshAuditProducts } from './audit/refresh';
import { auth, signOut } from './auth';
import { db } from './db';
import {
  CHAT_MODEL_IDS,
  IMAGE_QUALITY_IDS,
  audits,
  projects,
  users,
  type ChatModelDbId,
  type ImageQualityDbId
} from './db/schema';

/**
 * Server action wrapper around Auth.js' `signOut`. Used by client components
 * (e.g. the header user menu) which can't call `signOut` directly.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
}

/**
 * Update the current user's model preferences. Account-wide — applies to all
 * future generations across all projects. Called from the account preferences
 * page and from the inline selectors on the dashboard product page.
 */
export async function updateUserPreferencesAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const chatModelRaw = String(formData.get('chatModel') ?? '');
  const imageQualityRaw = String(formData.get('imageQuality') ?? '');

  const updates: {
    preferredChatModel?: ChatModelDbId;
    preferredImageQuality?: ImageQualityDbId;
  } = {};

  if ((CHAT_MODEL_IDS as readonly string[]).includes(chatModelRaw)) {
    updates.preferredChatModel = chatModelRaw as ChatModelDbId;
  }
  if ((IMAGE_QUALITY_IDS as readonly string[]).includes(imageQualityRaw)) {
    updates.preferredImageQuality = imageQualityRaw as ImageQualityDbId;
  }

  if (Object.keys(updates).length === 0) return;

  await db.update(users).set(updates).where(eq(users.id, session.user.id));

  // Refresh any view that surfaces the prefs (header, product page, etc).
  revalidatePath('/dashboard', 'layout');
  revalidatePath('/account/preferences');
}

/**
 * Mark a project as "just viewed" by stamping `lastViewedAt`. The dashboard
 * orders projects by this timestamp to auto-pick the most recently consulted
 * store when the user has more than one. Cheap UPDATE; safe to call on any
 * project page render.
 */
export async function touchProjectLastView(projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ lastViewedAt: new Date() })
    .where(eq(projects.id, projectId));
}

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

  const latest = await db.query.audits.findFirst({
    where: eq(audits.projectId, project.id),
    orderBy: [desc(audits.createdAt)]
  });

  // Cooldown gate. The UI is the primary line of defence (button is
  // disabled with a live timer); we re-check here so a forged form post
  // can't bypass it.
  const cooldownMs = auditCooldownMsForPlan(session.user.plan);
  if (latest) {
    const elapsed = Date.now() - latest.createdAt.getTime();
    if (elapsed < cooldownMs) return;
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
 * Save the site-wide AI instructions on a project. Verifies ownership before
 * writing. Empty / whitespace-only string clears the field. Combined at
 * generation time with any per-product instructions.
 */
export async function updateProjectInstructionsAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const projectId = String(formData.get('projectId') ?? '');
  const raw = String(formData.get('customInstructions') ?? '');
  if (!projectId) return;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.user.id))
  });
  if (!project) return;

  const trimmed = raw.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS).trim();
  await db
    .update(projects)
    .set({ customInstructions: trimmed.length > 0 ? trimmed : null })
    .where(eq(projects.id, projectId));

  revalidatePath(`/dashboard/sites/${projectId}`);
}

/**
 * Manually re-scrape the catalog of the user's project to refresh product
 * data without burning AI credits. Verifies ownership before running.
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

  // Manual refresh — forces a re-scrape regardless of freshness.
  const latest = await db.query.audits.findFirst({
    where: eq(audits.projectId, project.id),
    orderBy: [desc(audits.createdAt)]
  });
  if (latest) {
    await refreshAuditProducts(latest.id);
  }
  revalidatePath('/dashboard');
}
