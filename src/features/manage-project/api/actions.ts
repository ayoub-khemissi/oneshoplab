'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '@/entities/ai-model';
import { touchProjectLastView as touchLastView } from '@/entities/project';
import { auth } from '@/entities/user';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { findLanguage } from '@/lib/i18n/languages';

/**
 * Mark a project as "just viewed" by stamping `lastViewedAt`. The dashboard
 * orders projects by this timestamp to auto-pick the most recently consulted
 * store when the user has more than one. Cheap UPDATE; safe to call on any
 * project page render.
 *
 * Auth-gated: scoped to the project's owner so an attacker who guesses a
 * project UUID can't keep refreshing arbitrary `lastViewedAt` values to
 * mess with another merchant's dashboard ordering. No-ops silently when
 * the caller isn't authorised (this is a fire-and-forget action — the
 * page render shouldn't blow up on an auth glitch).
 */
export async function touchProjectLastView(projectId: string): Promise<void> {
  return touchLastView(projectId);
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
 * Persist a site-wide language override on a project. Verifies ownership
 * before writing. An empty string or unknown ISO code clears the override
 * (NULL in the DB, falling back to detection at generation time).
 */
export async function updateProjectLanguageAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const projectId = String(formData.get('projectId') ?? '');
  const rawCode = String(formData.get('languageCode') ?? '')
    .trim()
    .toLowerCase();
  if (!projectId) return;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.user.id))
  });
  if (!project) return;

  const validated = findLanguage(rawCode);
  await db
    .update(projects)
    .set({ languageOverride: validated ? validated.code : null })
    .where(eq(projects.id, projectId));

  revalidatePath(`/dashboard/sites/${projectId}`);
}

/**
 * Permanently delete a site (project) and everything that hangs off
 * it: audits, products, jobs, share links — all removed via FK
 * cascades on `projects.id`. Subscription / credit ledger live on
 * the user, not the project, so they're untouched.
 *
 * Idempotent: deleting an already-gone project is a no-op (the
 * ownership check returns early). The dashboard list revalidates so
 * the card disappears without a manual reload.
 */
export async function deleteProjectAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const projectId = String(formData.get('projectId') ?? '');
  if (!projectId) return;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.user.id))
  });
  if (!project) return;

  await db.delete(projects).where(eq(projects.id, projectId));
  revalidatePath('/dashboard');
}
