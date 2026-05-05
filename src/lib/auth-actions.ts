'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { auditCooldownMsForPlan, MAX_CUSTOM_INSTRUCTIONS_CHARS } from './ai/models';
import { launchAuditForUser } from './audit/launch';
import { refreshAuditProducts } from './audit/refresh';
import { auth, hashPassword, signOut } from './auth';
import { db } from './db';
import {
  CHAT_MODEL_IDS,
  IMAGE_QUALITY_IDS,
  audits,
  projects,
  subscriptions,
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

const MAX_NAME_LEN = 100;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;

/**
 * Update the signed-in user's display name. Empty input clears the name
 * (NULL on the row). Returned silently — the form revalidates the page
 * to surface the new value.
 */
export async function updateUserProfileAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const raw = String(formData.get('name') ?? '');
  const name = raw.trim().slice(0, MAX_NAME_LEN);
  await db
    .update(users)
    .set({ name: name.length > 0 ? name : null })
    .where(eq(users.id, session.user.id));

  revalidatePath('/account/profile');
  revalidatePath('/account', 'layout');
}

/**
 * Change the signed-in user's password. Requires the current password as
 * proof; bcrypt-compares server-side. The new password is stored as a
 * fresh bcrypt hash. Existing sessions stay valid (acceptable trade-off
 * for SaaS UX — the user just changed their own password).
 *
 * Surfaces failure via a `?error=` query string on the redirect target so
 * the page can render a localised message; success uses `?saved=1`.
 */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (!current || !next || !confirm) {
    redirect('/account/profile?error=missing_fields');
  }
  if (next !== confirm) {
    redirect('/account/profile?error=password_mismatch');
  }
  if (next.length < MIN_PASSWORD_LEN || next.length > MAX_PASSWORD_LEN) {
    redirect('/account/profile?error=password_weak');
  }

  const u = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!u?.passwordHash) {
    redirect('/account/profile?error=no_password');
  }
  const ok = await bcrypt.compare(current, u.passwordHash);
  if (!ok) {
    redirect('/account/profile?error=wrong_password');
  }

  const hashed = await hashPassword(next);
  await db.update(users).set({ passwordHash: hashed }).where(eq(users.id, u.id));

  redirect('/account/profile?saved=password');
}

/**
 * Permanently delete the signed-in user's account.
 *
 * Guard: an active / trialing / past_due subscription blocks deletion —
 * the merchant has to cancel via the Stripe portal first. Once the row
 * is gone, every dependent record (sessions, accounts, projects + their
 * audits / products / jobs, credit transactions, the subscriptions row
 * itself) is removed via the schema's ON DELETE CASCADE chain. The
 * Stripe customer object is intentionally LEFT in place for accounting;
 * a re-signup with the same email won't auto-link to it (we re-create).
 *
 * Requires the user's password as proof to keep the destruction explicit.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const password = String(formData.get('password') ?? '');
  if (!password) {
    redirect('/account/profile?error=missing_password');
  }

  const u = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!u?.passwordHash) {
    redirect('/account/profile?error=no_password');
  }
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) {
    redirect('/account/profile?error=wrong_password');
  }

  // Active subscription guard: Stripe billing keeps charging until cancelled,
  // so we never delete a row whose Stripe state is still live.
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, u.id)
  });
  if (sub && ['active', 'trialing', 'past_due', 'cancelling'].includes(sub.status)) {
    redirect('/account/profile?error=active_subscription');
  }

  await db.delete(users).where(eq(users.id, u.id));

  await signOut({ redirect: false });
  redirect('/?account_deleted=1');
}
