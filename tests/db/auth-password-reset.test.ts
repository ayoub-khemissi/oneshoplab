/**
 * Forgot / reset password, end to end against the test DB. The link is
 * captured from the (mocked) mailer, the token is single-use and expires,
 * and the flow never reveals whether an email exists.
 */
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  }
}));
const sendMail = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/mailer', () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));

import { requestPasswordResetAction, resetPasswordAction } from '@/features/auth';
import { db } from '@/lib/db';
import { passwordResetTokens, users } from '@/lib/db/schema';
import { createUser, resetTables } from './helpers';

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
  throw new Error('expected a redirect');
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
function tokenFromMail(): string {
  const call = sendMail.mock.calls.at(-1)?.[0] as { text?: string; html?: string } | undefined;
  const m = /reset-password\?token=([A-Za-z0-9_%.-]+)/.exec(call?.text ?? call?.html ?? '');
  if (!m) throw new Error('no reset link in mail');
  return decodeURIComponent(m[1]);
}
async function seedUser(email: string): Promise<string> {
  const id = await createUser();
  await db
    .update(users)
    .set({ email, passwordHash: await bcrypt.hash('old-password-1', 4) })
    .where(eq(users.id, id));
  return id;
}

beforeEach(async () => {
  await resetTables();
  sendMail.mockClear();
});
afterAll(async () => {
  await db.$client.end();
});

describe('requestPasswordResetAction', () => {
  it('issues a hashed, 1h token and emails the plaintext link', async () => {
    const userId = await seedUser('alice@test.local');
    const to = await redirectOf(requestPasswordResetAction(form({ email: 'Alice@Test.local ' })));
    expect(to).toBe('/forgot-password?sent=1');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const plaintext = tokenFromMail();
    expect(plaintext.length).toBeGreaterThanOrEqual(40);
    const rows = await db.query.passwordResetTokens.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].tokenHash).toBe(sha256(plaintext));
    expect(rows[0].usedAt).toBeNull();
    const ttl = rows[0].expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(55 * 60_000);
    expect(ttl).toBeLessThanOrEqual(61 * 60_000); // MySQL rounds to the second
  });

  it('answers identically for an unknown email and sends nothing (no enumeration)', async () => {
    const to = await redirectOf(requestPasswordResetAction(form({ email: 'nobody@test.local' })));
    expect(to).toBe('/forgot-password?sent=1');
    expect(sendMail).not.toHaveBeenCalled();
    expect(await db.query.passwordResetTokens.findMany()).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const to = await redirectOf(requestPasswordResetAction(form({ email: 'not-an-email' })));
    expect(to).toBe('/forgot-password?error=invalid_email');
  });

  it('cools down: a second request within a minute issues no new token and no mail', async () => {
    await seedUser('bob@test.local');
    await redirectOf(requestPasswordResetAction(form({ email: 'bob@test.local' })));
    const to = await redirectOf(requestPasswordResetAction(form({ email: 'bob@test.local' })));
    expect(to).toBe('/forgot-password?sent=1');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(await db.query.passwordResetTokens.findMany()).toHaveLength(1);
  });
});

describe('resetPasswordAction', () => {
  async function issue(email: string): Promise<{ userId: string; token: string }> {
    const userId = await seedUser(email);
    await redirectOf(requestPasswordResetAction(form({ email })));
    return { userId, token: tokenFromMail() };
  }

  it('sets the new password, marks the token used, and refuses a second use', async () => {
    const { userId, token } = await issue('carol@test.local');
    const to = await redirectOf(
      resetPasswordAction(
        form({ token, password: 'new-password-42', confirm_password: 'new-password-42' })
      )
    );
    expect(to).toBe('/login?reset=1');
    const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(await bcrypt.compare('new-password-42', u!.passwordHash!)).toBe(true);
    expect(await bcrypt.compare('old-password-1', u!.passwordHash!)).toBe(false);
    const [row] = await db.query.passwordResetTokens.findMany();
    expect(row.usedAt).toBeInstanceOf(Date);

    const again = await redirectOf(
      resetPasswordAction(
        form({ token, password: 'another-pass-1', confirm_password: 'another-pass-1' })
      )
    );
    expect(again).toBe('/reset-password?error=invalid_token');
    const u2 = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(u2!.passwordHash).toBe(u!.passwordHash);
  });

  it('refuses an expired token', async () => {
    const { userId, token } = await issue('dave@test.local');
    await db.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    const to = await redirectOf(
      resetPasswordAction(
        form({ token, password: 'new-password-42', confirm_password: 'new-password-42' })
      )
    );
    expect(to).toBe('/reset-password?error=invalid_token');
    const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(await bcrypt.compare('old-password-1', u!.passwordHash!)).toBe(true);
  });

  it('refuses unknown, missing, short and mismatched inputs without touching the DB', async () => {
    const { userId, token } = await issue('erin@test.local');
    expect(
      await redirectOf(
        resetPasswordAction(
          form({ token: 'bogus', password: 'new-password-42', confirm_password: 'new-password-42' })
        )
      )
    ).toBe('/reset-password?error=invalid_token');
    expect(
      await redirectOf(
        resetPasswordAction(
          form({ password: 'new-password-42', confirm_password: 'new-password-42' })
        )
      )
    ).toBe('/reset-password?error=missing_token');
    expect(
      await redirectOf(
        resetPasswordAction(form({ token, password: 'short', confirm_password: 'short' }))
      )
    ).toContain('error=short_password');
    expect(
      await redirectOf(
        resetPasswordAction(
          form({ token, password: 'new-password-42', confirm_password: 'new-password-43' })
        )
      )
    ).toContain('error=mismatch');
    const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(await bcrypt.compare('old-password-1', u!.passwordHash!)).toBe(true);
    const [row] = await db.query.passwordResetTokens.findMany();
    expect(row.usedAt).toBeNull();
  });
});
