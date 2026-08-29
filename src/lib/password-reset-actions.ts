'use server';

import { and, eq, gte, isNull } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { hashPassword } from './password';
import { db } from './db';
import { passwordResetTokens, users } from './db/schema';
import { sendMail } from './mailer';

const TOKEN_TTL_MS = 60 * 60_000; // 1h
/** Per-email cooldown so a malicious actor can't spam someone's
 *  inbox by hitting /forgot-password in a loop. We measure against
 *  the most recent active (not-yet-used and not-yet-expired) token. */
const MIN_ISSUE_INTERVAL_MS = 60_000; // 1 min

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Step 1: user types their email on /forgot-password and submits.
 *
 * This action ALWAYS redirects to a "if your email exists, a link
 * was sent" generic page — never reveals whether the email is in
 * the DB. That's the whole point: account-enumeration via the
 * password-reset endpoint is a classic OWASP finding.
 *
 * Real work happens off the user-visible path:
 *   - Look up the user. If absent → silent no-op.
 *   - Issue a 32-byte random token, store its sha256 hash + 1h
 *     expiry.
 *   - Email a `/reset-password?token=<plaintext>` link.
 *   - Per-email rate-limit: latest active token < 60s old → skip
 *     issuing a new one (still respond OK to the user).
 */
export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const emailRaw = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();
  if (!emailRaw.includes('@') || emailRaw.length < 3) {
    redirect(`/forgot-password?error=invalid_email`);
  }

  // Always advance to the generic "sent" screen — even on bad email,
  // unknown email, or send failure. Anti-enumeration.
  const sentRedirect = `/forgot-password?sent=1`;

  const user = await db.query.users.findFirst({ where: eq(users.email, emailRaw) });
  if (!user) {
    redirect(sentRedirect);
  }

  // OAuth-only users (passwordHash null) have nothing to reset.
  // Quietly skip; UI message is the same.
  if (!user.passwordHash) {
    redirect(sentRedirect);
  }

  // Cool-down: ignore the request if a fresh token was issued in the
  // last MIN_ISSUE_INTERVAL_MS. Same generic response.
  const recentCutoff = new Date(Date.now() - MIN_ISSUE_INTERVAL_MS);
  const recent = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.userId, user.id),
      gte(passwordResetTokens.createdAt, recentCutoff),
      isNull(passwordResetTokens.usedAt)
    )
  });
  if (recent) {
    redirect(sentRedirect);
  }

  const plaintext = randomBytes(32).toString('base64url');
  await db.insert(passwordResetTokens).values({
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashToken(plaintext),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
  });

  const appUrl = (process.env.APP_URL ?? 'http://localhost:3030').replace(/\/$/, '');
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(plaintext)}`;

  // Best-effort send. If the SMTP relay rejects, we log and still
  // redirect the user to the generic screen — they'll click the
  // resend link in 1 min if needed.
  void sendMail({
    to: user.email,
    subject: 'Reset your OneShopLab password',
    text: `Hi${user.name ? ' ' + user.name : ''},

We received a request to reset your OneShopLab password. Click the link below to choose a new one:

${link}

This link expires in 1 hour. If you didn't request a reset, ignore this email.

— OneShopLab`,
    html: `<p>Hi${user.name ? ' ' + escapeHtml(user.name) : ''},</p>
<p>We received a request to reset your OneShopLab password. Click the link below to choose a new one:</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Reset my password</a></p>
<p>Or paste this URL into your browser:<br><code>${escapeHtml(link)}</code></p>
<p style="color:#888;font-size:12px">This link expires in 1 hour. If you didn't request a reset, ignore this email.</p>`
  }).catch((e) => console.error('[password-reset] sendMail threw', e));

  redirect(sentRedirect);
}

/**
 * Step 2: user clicks the link and lands on /reset-password?token=…,
 * fills the new-password form, submits.
 *
 * Validates the token (still active + not used + not expired), sets
 * the new bcrypt hash, marks the token used. Subsequent uses of the
 * same token are rejected — single-use is what makes "leak the URL
 * once" non-catastrophic.
 *
 * On success → /login?reset=1 with a one-shot success toast.
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm_password') ?? '');

  if (!token) {
    redirect(`/reset-password?error=missing_token`);
  }
  if (password.length < 8) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=short_password`);
  }
  if (password !== confirm) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=mismatch`);
  }

  const hash = hashToken(token);
  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, hash)
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    redirect(`/reset-password?error=invalid_token`);
  }
  // TS narrowing — `row` is non-null on this branch.
  if (!row) return;

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
  });

  redirect(`/login?reset=1`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
