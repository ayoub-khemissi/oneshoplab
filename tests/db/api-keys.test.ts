/**
 * Site-key lifecycle against MySQL: create → verify → touch → rotate
 * (grace) → revoke, expiry, ownership isolation and the audit trail.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { apiKeyEvents, apiKeys } from '@/shared/db/schema';
import {
  createApiKey,
  expireDueKeys,
  listProjectKeys,
  revokeApiKey,
  revokeGraceExpired,
  rotateApiKey,
  touchLastUsed,
  verifyApiKey
} from '@/entities/api-key';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;
let otherUser: string;

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
  otherUser = await createUser();
});
afterAll(async () => {
  await db.$client.end();
});

async function eventKinds(keyId: string): Promise<string[]> {
  const rows = await db.select().from(apiKeyEvents).where(eq(apiKeyEvents.apiKeyId, keyId));
  return rows.map((r) => r.kind).sort();
}

async function create(name = 'plugin', extra: { expiresAt?: Date } = {}) {
  const res = await createApiKey({ projectId, userId, name, ...extra });
  if (!res.ok) throw new Error('create failed');
  return res.value;
}

describe('api keys', () => {
  it('create → verify → touch', async () => {
    const { key, plaintext } = await create();
    expect(plaintext).toMatch(/^osl_live_[A-Za-z0-9_-]{43}$/);
    expect(key.prefix).toBe(plaintext.slice(0, 12));
    expect('keyHash' in key).toBe(false);
    expect(key.permissions).toEqual(['catalog:write', 'changes:read', 'changes:ack']);

    const v = await verifyApiKey(plaintext);
    expect(v.ok && v.key.id).toBe(key.id);
    expect(await verifyApiKey(plaintext.slice(0, -1) + 'Z')).toMatchObject({
      ok: false,
      reason: 'unauthorized',
      keyId: key.id
    });
    expect(await verifyApiKey('nonsense')).toEqual({ ok: false, reason: 'unauthorized' });

    expect(await touchLastUsed(key.id, '10.0.0.1')).toBe(true);
    expect(await touchLastUsed(key.id, '10.0.0.2')).toBe(false); // throttled
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row.lastUsedIp).toBe('10.0.0.1');
    expect(row.lastUsedAt).toBeInstanceOf(Date);
    expect(await eventKinds(key.id)).toEqual(['created']);
  });

  it('rotate keeps both keys valid during grace, then the worker revokes the old one', async () => {
    const { key: oldKey, plaintext: oldPlain } = await create();
    const rot = await rotateApiKey({ keyId: oldKey.id, userId });
    if (!rot.ok) throw new Error('rotate failed');
    const { key: newKey, plaintext: newPlain } = rot.value;
    expect(newKey.projectId).toBe(projectId);
    expect(newKey.permissions).toEqual(oldKey.permissions);

    const [old] = await db.select().from(apiKeys).where(eq(apiKeys.id, oldKey.id));
    expect(old.rotatedToId).toBe(newKey.id);
    expect(old.graceUntil!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

    expect((await verifyApiKey(oldPlain)).ok).toBe(true);
    expect((await verifyApiKey(newPlain)).ok).toBe(true);
    // Past graceUntil the old key is refused even before the sweep runs.
    const after = new Date(old.graceUntil!.getTime() + 1000);
    expect(await verifyApiKey(oldPlain, after)).toMatchObject({ ok: false, reason: 'key_revoked' });
    expect((await verifyApiKey(newPlain, after)).ok).toBe(true);

    expect(await revokeGraceExpired(new Date())).toBe(0);
    expect(await revokeGraceExpired(after)).toBe(1);
    expect(await verifyApiKey(oldPlain)).toMatchObject({ ok: false, reason: 'key_revoked' });
    expect(await eventKinds(oldKey.id)).toEqual(['created', 'revoked', 'rotated']);
    expect(await eventKinds(newKey.id)).toEqual(['created']);
    // A rotated key cannot be rotated twice.
    expect(await rotateApiKey({ keyId: oldKey.id, userId })).toEqual({
      ok: false,
      reason: 'not_active'
    });
  });

  it('revoke is immediate and idempotent', async () => {
    const { key, plaintext } = await create();
    expect((await revokeApiKey({ keyId: key.id, userId })).ok).toBe(true);
    expect(await verifyApiKey(plaintext)).toMatchObject({ ok: false, reason: 'key_revoked' });
    expect((await revokeApiKey({ keyId: key.id, userId })).ok).toBe(true);
    expect(await eventKinds(key.id)).toEqual(['created', 'revoked']);
    expect(await rotateApiKey({ keyId: key.id, userId })).toEqual({
      ok: false,
      reason: 'not_active'
    });
  });

  it('expiry: key_expired (distinct from revoked) and one expired event', async () => {
    const past = new Date(Date.now() - 60_000);
    const { key, plaintext } = await create('short', { expiresAt: past });
    expect(await verifyApiKey(plaintext)).toMatchObject({ ok: false, reason: 'key_expired' });
    expect(await expireDueKeys()).toBe(1);
    expect(await expireDueKeys()).toBe(0);
    expect(await eventKinds(key.id)).toEqual(['created', 'expired']);
  });

  it('caps expiry at 2 years', async () => {
    const { key } = await create('long', {
      expiresAt: new Date(Date.now() + 10 * 365 * 86400_000)
    });
    expect(key.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 365 * 86400_000 + 5000);
  });

  it('a foreign project or key is never visible to another user', async () => {
    const { key } = await create();
    expect(await createApiKey({ projectId, userId: otherUser, name: 'x' })).toEqual({
      ok: false,
      reason: 'not_found'
    });
    expect(await rotateApiKey({ keyId: key.id, userId: otherUser })).toEqual({
      ok: false,
      reason: 'not_found'
    });
    expect(await revokeApiKey({ keyId: key.id, userId: otherUser })).toEqual({
      ok: false,
      reason: 'not_found'
    });
    expect(await listProjectKeys({ projectId, userId: otherUser })).toEqual([]);
    const mine = await listProjectKeys({ projectId, userId });
    expect(mine.map((k) => k.id)).toEqual([key.id]);
    expect((await verifyApiKey((await create('second')).plaintext)).ok).toBe(true);
    expect(await listProjectKeys({ projectId, userId })).toHaveLength(2);
  });
});
