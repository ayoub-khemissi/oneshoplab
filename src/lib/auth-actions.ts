'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { gte, inArray } from 'drizzle-orm';
import {
  AUDIT_RATE_LIMIT_WINDOW_MS,
  auditRateLimitForPlan,
  MAX_CUSTOM_INSTRUCTIONS_CHARS
} from './ai/models';
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

export interface ActionResult {
  ok: boolean;
  /** Error code resolved client-side to a localised message. */
  errorCode?: string;
}

/**
 * Update the signed-in user's display name. Empty input clears the name
 * (NULL on the row). Returns a tagged result so the client form can show
 * an inline "Saved" confirmation.
 */
export async function updateUserProfileAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, errorCode: 'unauthorized' };

  const raw = String(formData.get('name') ?? '');
  const name = raw.trim().slice(0, MAX_NAME_LEN);
  await db
    .update(users)
    .set({ name: name.length > 0 ? name : null })
    .where(eq(users.id, session.user.id));

  revalidatePath('/account/profile');
  revalidatePath('/account', 'layout');
  return { ok: true };
}

/**
 * Change the signed-in user's password. Requires the current password as
 * proof; bcrypt-compares server-side. The new password is stored as a
 * fresh bcrypt hash. Existing sessions stay valid (acceptable trade-off
 * for SaaS UX — the user just changed their own password).
 *
 * Returns a tagged result; the client form renders the inline "Saved" /
 * error feedback locally (matches the rest of the app's UX pattern).
 */
export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, errorCode: 'unauthorized' };

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (!current || !next || !confirm) return { ok: false, errorCode: 'missing_fields' };
  if (next !== confirm) return { ok: false, errorCode: 'password_mismatch' };
  if (next.length < MIN_PASSWORD_LEN || next.length > MAX_PASSWORD_LEN)
    return { ok: false, errorCode: 'password_weak' };

  const u = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!u?.passwordHash) return { ok: false, errorCode: 'no_password' };

  const ok = await bcrypt.compare(current, u.passwordHash);
  if (!ok) return { ok: false, errorCode: 'wrong_password' };

  const hashed = await hashPassword(next);
  await db.update(users).set({ passwordHash: hashed }).where(eq(users.id, u.id));

  return { ok: true };
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
export async function deleteAccountAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, errorCode: 'unauthorized' };

  const password = String(formData.get('password') ?? '');
  if (!password) return { ok: false, errorCode: 'missing_password' };

  const u = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!u?.passwordHash) return { ok: false, errorCode: 'no_password' };

  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return { ok: false, errorCode: 'wrong_password' };

  // Active subscription guard: Stripe billing keeps charging until cancelled,
  // so we never delete a row whose Stripe state is still live.
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, u.id)
  });
  if (sub && ['active', 'trialing', 'past_due', 'cancelling'].includes(sub.status)) {
    return { ok: false, errorCode: 'active_subscription' };
  }

  await db.delete(users).where(eq(users.id, u.id));

  await signOut({ redirect: false });
  // Terminal redirect — the client form's await will be interrupted by the
  // framework's NEXT_REDIRECT signal, so we never actually return ok:true.
  redirect('/?account_deleted=1');
}
