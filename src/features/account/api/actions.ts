'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { auth, hashPassword, signOut } from '@/entities/user';
import { db } from '@/lib/db';
import { subscriptions, users } from '@/lib/db/schema';

/**
 * Server action wrapper around Auth.js' `signOut`. Used by client components
 * (e.g. the header user menu) which can't call `signOut` directly.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
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
 * Confirmation gate: the user must re-type their own email exactly
 * (case-insensitive). Email works regardless of how the user signed
 * up — password-only users, Google-OAuth users, or hybrid (linked).
 * Bcrypt password matching used to be the gate but it locked OAuth
 * users out of self-deletion entirely.
 */
export async function deleteAccountAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, errorCode: 'unauthorized' };

  const u = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!u) return { ok: false, errorCode: 'unauthorized' };

  const typed = String(formData.get('email_confirmation') ?? '')
    .toLowerCase()
    .trim();
  if (!typed) return { ok: false, errorCode: 'missing_email' };
  if (typed !== (u.email ?? '').toLowerCase().trim()) {
    return { ok: false, errorCode: 'email_mismatch' };
  }

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
