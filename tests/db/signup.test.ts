/**
 * Credentials signup must leave the same trail as an OAuth signup: welcome
 * credits through the ledger (idempotent) and a signup_tos consent row.
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SIGNUP_FREE_CREDITS } from '@/entities/ai-model';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { LEGAL_TERMS_VERSION } from '@/entities/legal-consent';
import { registerCredentialsUser } from '@/entities/user';
import { buckets, ledgerSum, resetTables } from './helpers';

beforeEach(resetTables);
afterAll(async () => {
  await db.$client.end();
});

describe('registerCredentialsUser', () => {
  it('creates the user with hashed password, ledger-backed welcome credits and consent proof', async () => {
    const res = await registerCredentialsUser({
      email: ' New.User@Test.LOCAL ',
      password: 'correct-horse-9',
      name: '  Nadia ',
      locale: 'fr'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const u = (await db.query.users.findFirst({ where: eq(users.id, res.userId) }))!;
    expect(u).toMatchObject({ email: 'new.user@test.local', name: 'Nadia', plan: 'free' });
    expect(await bcrypt.compare('correct-horse-9', u.passwordHash!)).toBe(true);

    expect(await buckets(res.userId)).toEqual({
      total: SIGNUP_FREE_CREDITS,
      sub: 0,
      pack: SIGNUP_FREE_CREDITS
    });
    expect(await ledgerSum(res.userId)).toBe(SIGNUP_FREE_CREDITS);
    const [tx] = await db.query.creditTransactions.findMany();
    expect(tx).toMatchObject({
      reason: 'signup_grant',
      idempotencyKey: `grant-signup-${res.userId}`
    });

    const [consent] = await db.query.legalConsents.findMany();
    expect(consent).toMatchObject({
      userId: res.userId,
      kind: 'signup_tos',
      version: LEGAL_TERMS_VERSION,
      source: `user:${res.userId}`,
      locale: 'fr'
    });
  });

  it('rejects bad input and duplicate emails (case-insensitive) without side effects', async () => {
    expect(await registerCredentialsUser({ email: 'x', password: 'correct-horse-9' })).toEqual({
      ok: false,
      error: 'invalid_email'
    });
    expect(await registerCredentialsUser({ email: 'a@test.local', password: 'short' })).toEqual({
      ok: false,
      error: 'short_password'
    });
    expect(
      (await registerCredentialsUser({ email: 'a@test.local', password: 'correct-horse-9' })).ok
    ).toBe(true);
    expect(
      await registerCredentialsUser({ email: 'A@TEST.local', password: 'correct-horse-9' })
    ).toEqual({
      ok: false,
      error: 'email_taken'
    });
    expect(await db.query.users.findMany()).toHaveLength(1);
    expect(await db.query.legalConsents.findMany()).toHaveLength(1);
  });
});
