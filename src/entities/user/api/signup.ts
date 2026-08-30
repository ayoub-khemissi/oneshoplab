import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { SIGNUP_FREE_CREDITS } from '@/entities/ai-model';
import { applyCreditTransaction } from '@/entities/credit';
import { db } from '@/shared/db';
import { legalConsents, users } from '@/shared/db/schema';
import { LEGAL_TERMS_VERSION } from '@/entities/legal-consent';
import { hashPassword } from '../model/password';

export type SignupError = 'invalid_email' | 'short_password' | 'email_taken';

/**
 * Credentials signup — the mirror of the OAuth `createUser` adapter event in
 * lib/auth.ts, so BOTH paths end up identical: welcome credits granted through
 * the ledger (balance == SUM(ledger), idempotent per user) and a `signup_tos`
 * consent row as proof of the click-wrap on the form. Before this module the
 * credentials path wrote the credit buckets directly and recorded no consent.
 */
export async function registerCredentialsUser(input: {
  email: string;
  password: string;
  name?: string | null;
  locale?: string | null;
}): Promise<{ ok: true; userId: string } | { ok: false; error: SignupError }> {
  const email = input.email.toLowerCase().trim();
  if (!email.includes('@') || email.length < 3) return { ok: false, error: 'invalid_email' };
  if (input.password.length < 8) return { ok: false, error: 'short_password' };

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return { ok: false, error: 'email_taken' };

  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  await db.insert(users).values({
    id: userId,
    email,
    name: input.name?.trim() || null,
    passwordHash,
    plan: 'free'
  });
  await applyCreditTransaction({
    userId,
    delta: SIGNUP_FREE_CREDITS,
    bucket: 'pack',
    reason: 'signup_grant',
    idempotencyKey: `grant-signup-${userId}`
  });
  await db.insert(legalConsents).values({
    id: randomUUID(),
    userId,
    kind: 'signup_tos',
    version: LEGAL_TERMS_VERSION,
    source: `user:${userId}`,
    locale: input.locale ?? null
  });
  return { ok: true, userId };
}
