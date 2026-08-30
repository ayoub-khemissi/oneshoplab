/**
 * Account actions behind a session: change password, delete account
 * (blocked while a Stripe subscription is live, cascades otherwise).
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
const signOut = vi.hoisted(() => vi.fn());
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null),
  signOut: (...a: unknown[]) => signOut(...a),
  hashPassword: (p: string) => bcrypt.hash(p, 4)
}));
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
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { changePasswordAction, deleteAccountAction } from '@/features/account';
import { applyCreditTransaction } from '@/entities/credit';
import { db } from '@/lib/db';
import { creditTransactions, projects, subscriptions, users } from '@/lib/db/schema';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function seed(email = 'me@test.local'): Promise<string> {
  const id = await createUser();
  await db
    .update(users)
    .set({ email, passwordHash: await bcrypt.hash('current-pass-1', 4) })
    .where(eq(users.id, id));
  session.userId = id;
  return id;
}

beforeEach(async () => {
  await resetTables();
  session.userId = null;
  signOut.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  await db.$client.end();
});

describe('changePasswordAction', () => {
  it('validates, checks the current password, then re-hashes', async () => {
    expect(
      await changePasswordAction(
        form({ currentPassword: 'x', newPassword: 'new-pass-123', confirmPassword: 'new-pass-123' })
      )
    ).toEqual({ ok: false, errorCode: 'unauthorized' });

    const id = await seed();
    const ok = (o: Record<string, string>) => changePasswordAction(form(o));
    expect(await ok({ currentPassword: '', newPassword: 'a', confirmPassword: 'a' })).toEqual({
      ok: false,
      errorCode: 'missing_fields'
    });
    expect(
      await ok({
        currentPassword: 'current-pass-1',
        newPassword: 'new-pass-123',
        confirmPassword: 'other'
      })
    ).toEqual({ ok: false, errorCode: 'password_mismatch' });
    expect(
      await ok({
        currentPassword: 'current-pass-1',
        newPassword: 'short',
        confirmPassword: 'short'
      })
    ).toEqual({ ok: false, errorCode: 'password_weak' });
    expect(
      await ok({
        currentPassword: 'wrong',
        newPassword: 'new-pass-123',
        confirmPassword: 'new-pass-123'
      })
    ).toEqual({ ok: false, errorCode: 'wrong_password' });
    expect(
      await ok({
        currentPassword: 'current-pass-1',
        newPassword: 'new-pass-123',
        confirmPassword: 'new-pass-123'
      })
    ).toEqual({ ok: true });
    const u = await db.query.users.findFirst({ where: eq(users.id, id) });
    expect(await bcrypt.compare('new-pass-123', u!.passwordHash!)).toBe(true);
  });

  it('refuses for OAuth-only accounts without a password', async () => {
    const id = await seed();
    await db.update(users).set({ passwordHash: null }).where(eq(users.id, id));
    expect(
      await changePasswordAction(
        form({ currentPassword: 'x', newPassword: 'new-pass-123', confirmPassword: 'new-pass-123' })
      )
    ).toEqual({ ok: false, errorCode: 'no_password' });
  });
});

describe('deleteAccountAction', () => {
  it('requires the typed email to match', async () => {
    await seed('me@test.local');
    expect(await deleteAccountAction(form({ email_confirmation: '' }))).toEqual({
      ok: false,
      errorCode: 'missing_email'
    });
    expect(await deleteAccountAction(form({ email_confirmation: 'other@test.local' }))).toEqual({
      ok: false,
      errorCode: 'email_mismatch'
    });
    expect(await db.query.users.findMany()).toHaveLength(1);
  });

  it('is blocked while a subscription is still live on Stripe', async () => {
    const id = await seed();
    await db.insert(subscriptions).values({
      id: randomUUID(),
      userId: id,
      stripeCustomerId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
      plan: 'pro',
      status: 'active',
      billingCycle: 'monthly'
    });
    expect(await deleteAccountAction(form({ email_confirmation: 'me@test.local' }))).toEqual({
      ok: false,
      errorCode: 'active_subscription'
    });
    expect(await db.query.users.findMany()).toHaveLength(1);
  });

  it('deletes the user and everything hanging off it, then signs out and redirects', async () => {
    const id = await seed();
    const other = await createUser();
    await createProject(id);
    await createProject(other);
    await applyCreditTransaction({ userId: id, delta: 10, reason: 'grant' });

    let to = '';
    try {
      await deleteAccountAction(form({ email_confirmation: ' ME@test.local ' }));
    } catch (e) {
      if (!(e instanceof RedirectSignal)) throw e;
      to = e.to;
    }
    expect(to).toBe('/?account_deleted=1');
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
    expect(await db.query.users.findFirst({ where: eq(users.id, id) })).toBeUndefined();
    expect(await db.query.projects.findMany({ where: eq(projects.userId, id) })).toHaveLength(0);
    expect(
      await db.query.creditTransactions.findMany({ where: eq(creditTransactions.userId, id) })
    ).toHaveLength(0);
    // The other user is untouched.
    expect(await db.query.projects.findMany({ where: eq(projects.userId, other) })).toHaveLength(1);
  });
});
