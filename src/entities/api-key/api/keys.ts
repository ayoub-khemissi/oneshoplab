/**
 * Site-key lifecycle. Plaintext keys exist only in the `createApiKey` /
 * `rotateApiKey` return value; the table holds the prefix + sha256.
 * Every mutation takes the acting `userId` and answers `not_found` for a
 * key/project the user does not own (no existence leak, never throws).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, lt, lte, notExists, or, sql } from 'drizzle-orm';
import { db } from '@/shared/db';
import {
  API_KEY_PERMISSIONS,
  apiKeyEvents,
  apiKeys,
  projects,
  type ApiKeyEventKind
} from '@/shared/db/schema';
import {
  generateApiKey,
  hashKey,
  looksLikeApiKey,
  prefixOf,
  timingSafeEqualHex
} from '../lib/format';
import type {
  ApiKeyRow,
  CreateApiKeyInput,
  CreatedApiKey,
  OwnedResult,
  VerifyApiKeyResult
} from '../model/types';

export const KEY_GRACE_MS = 24 * 60 * 60 * 1000;
export const KEY_MAX_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_SEC = 60;

type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function stripHash(row: typeof apiKeys.$inferSelect): ApiKeyRow {
  const { keyHash: _keyHash, ...rest } = row;
  return rest;
}

export async function recordKeyEvent(
  apiKeyId: string,
  kind: ApiKeyEventKind,
  opts: { ip?: string | null; meta?: Record<string, unknown> | null } = {},
  exec: Exec = db
): Promise<void> {
  await exec.insert(apiKeyEvents).values({
    id: randomUUID(),
    apiKeyId,
    kind,
    ip: opts.ip ?? null,
    meta: opts.meta ?? null
  });
}

async function ownsProject(projectId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return Boolean(row);
}

async function ownedKey(keyId: string, userId: string) {
  const [row] = await db
    .select({ key: apiKeys })
    .from(apiKeys)
    .innerJoin(projects, eq(projects.id, apiKeys.projectId))
    .where(and(eq(apiKeys.id, keyId), eq(projects.userId, userId)));
  return row?.key ?? null;
}

async function insertKey(
  exec: Exec,
  input: Omit<CreateApiKeyInput, 'ip'>
): Promise<{ id: string; plaintext: string }> {
  const plaintext = generateApiKey();
  const id = randomUUID();
  await exec.insert(apiKeys).values({
    id,
    projectId: input.projectId,
    userId: input.userId,
    name: input.name,
    prefix: prefixOf(plaintext),
    keyHash: hashKey(plaintext),
    permissions: input.permissions ?? [...API_KEY_PERMISSIONS],
    expiresAt: input.expiresAt ?? null
  });
  return { id, plaintext };
}

export async function createApiKey(input: CreateApiKeyInput): Promise<OwnedResult<CreatedApiKey>> {
  if (!(await ownsProject(input.projectId, input.userId))) {
    return { ok: false, reason: 'not_found' };
  }
  if (input.expiresAt && input.expiresAt.getTime() > Date.now() + KEY_MAX_TTL_MS) {
    input = { ...input, expiresAt: new Date(Date.now() + KEY_MAX_TTL_MS) };
  }
  const { id, plaintext } = await insertKey(db, input);
  await recordKeyEvent(id, 'created', { ip: input.ip });
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
  return { ok: true, value: { key: stripHash(row), plaintext } };
}

/** Lookup by prefix (unique index) then constant-time compare of the hash. */
export async function verifyApiKey(
  plaintext: string,
  now: Date = new Date()
): Promise<VerifyApiKeyResult> {
  if (!looksLikeApiKey(plaintext)) return { ok: false, reason: 'unauthorized' };
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.prefix, prefixOf(plaintext)));
  if (!row) return { ok: false, reason: 'unauthorized' };
  if (!timingSafeEqualHex(row.keyHash, hashKey(plaintext))) {
    return { ok: false, reason: 'unauthorized', keyId: row.id };
  }
  if (row.revokedAt) return { ok: false, reason: 'key_revoked', keyId: row.id };
  if (row.graceUntil && row.graceUntil.getTime() <= now.getTime()) {
    return { ok: false, reason: 'key_revoked', keyId: row.id };
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'key_expired', keyId: row.id };
  }
  return { ok: true, key: stripHash(row) };
}

/** Stamps lastUsedAt/Ip at most once a minute per key (guarded UPDATE). */
export async function touchLastUsed(keyId: string, ip: string | null): Promise<boolean> {
  const [res] = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIp: ip })
    .where(
      and(
        eq(apiKeys.id, keyId),
        // Cutoff computed here, not with NOW(): the server clock is CEST
        // while stored timestamps are UTC (see shared/db timezone note).
        or(
          isNull(apiKeys.lastUsedAt),
          lt(apiKeys.lastUsedAt, new Date(Date.now() - TOUCH_INTERVAL_SEC * 1000))
        )
      )
    );
  return res.affectedRows > 0;
}

/** New key, same project/permissions; the old one stays valid for 24 h. */
export async function rotateApiKey(input: {
  keyId: string;
  userId: string;
  ip?: string | null;
}): Promise<OwnedResult<CreatedApiKey>> {
  const old = await ownedKey(input.keyId, input.userId);
  if (!old) return { ok: false, reason: 'not_found' };
  if (old.revokedAt || old.rotatedToId) return { ok: false, reason: 'not_active' };

  const graceUntil = new Date(Date.now() + KEY_GRACE_MS);
  const created = await db.transaction(async (tx) => {
    const next = await insertKey(tx, {
      projectId: old.projectId,
      userId: old.userId,
      name: old.name,
      permissions: old.permissions,
      expiresAt: old.expiresAt
    });
    await tx
      .update(apiKeys)
      .set({ rotatedToId: next.id, graceUntil })
      .where(eq(apiKeys.id, old.id));
    await recordKeyEvent(next.id, 'created', { ip: input.ip, meta: { rotatedFrom: old.id } }, tx);
    await recordKeyEvent(old.id, 'rotated', { ip: input.ip, meta: { rotatedTo: next.id } }, tx);
    return next;
  });
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.id));
  return { ok: true, value: { key: stripHash(row), plaintext: created.plaintext } };
}

/** Immediate; idempotent on an already revoked key. */
export async function revokeApiKey(input: {
  keyId: string;
  userId: string;
  ip?: string | null;
  reason?: string;
}): Promise<OwnedResult<ApiKeyRow>> {
  const key = await ownedKey(input.keyId, input.userId);
  if (!key) return { ok: false, reason: 'not_found' };
  if (key.revokedAt) return { ok: true, value: stripHash(key) };
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key.id));
  await recordKeyEvent(key.id, 'revoked', {
    ip: input.ip,
    meta: input.reason ? { reason: input.reason } : null
  });
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
  return { ok: true, value: stripHash(row) };
}

export async function listProjectKeys(input: {
  projectId: string;
  userId: string;
}): Promise<ApiKeyRow[]> {
  const rows = await db
    .select({ key: apiKeys })
    .from(apiKeys)
    .innerJoin(projects, eq(projects.id, apiKeys.projectId))
    .where(and(eq(apiKeys.projectId, input.projectId), eq(projects.userId, input.userId)))
    .orderBy(apiKeys.createdAt);
  return rows.map((r) => stripHash(r.key));
}

/** Key ids + owner scope, what the sweeps need to raise an alert. */
export interface SweptKey {
  id: string;
  projectId: string;
  name: string;
  expiresAt: Date | null;
}
const sweptColumns = {
  id: apiKeys.id,
  projectId: apiKeys.projectId,
  name: apiKeys.name,
  expiresAt: apiKeys.expiresAt
};

function withoutEvent(kind: ApiKeyEventKind) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(apiKeyEvents)
      .where(and(eq(apiKeyEvents.apiKeyId, apiKeys.id), eq(apiKeyEvents.kind, kind)))
  );
}

/**
 * Worker: log one `expired` event per key that crossed `expiresAt`
 * (the status itself is derived from the column — nothing else to flip).
 * Returns the keys it just expired so the caller can alert the owner.
 */
export async function expireDueKeys(now: Date = new Date()): Promise<SweptKey[]> {
  const due = await db
    .select(sweptColumns)
    .from(apiKeys)
    .where(and(lte(apiKeys.expiresAt, now), isNull(apiKeys.revokedAt), withoutEvent('expired')));
  for (const k of due) await recordKeyEvent(k.id, 'expired');
  return due;
}

/** J-7 window of the expiry email (docs/api/INTEGRATION-API.md §2). */
export const EXPIRY_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Worker: keys expiring within EXPIRY_NOTICE_MS that were never noticed.
 * Records the `expiry_notice` event (the once-per-key marker) and returns them.
 */
export async function claimExpiringKeys(now: Date = new Date()): Promise<SweptKey[]> {
  const due = await db
    .select(sweptColumns)
    .from(apiKeys)
    .where(
      and(
        gt(apiKeys.expiresAt, now),
        lte(apiKeys.expiresAt, new Date(now.getTime() + EXPIRY_NOTICE_MS)),
        isNull(apiKeys.revokedAt),
        withoutEvent('expiry_notice')
      )
    );
  for (const k of due) await recordKeyEvent(k.id, 'expiry_notice');
  return due;
}

/** Worker: revoke rotated keys whose grace window closed. */
export async function revokeGraceExpired(now: Date = new Date()): Promise<SweptKey[]> {
  const due = await db
    .select(sweptColumns)
    .from(apiKeys)
    .where(and(lte(apiKeys.graceUntil, now), isNull(apiKeys.revokedAt)));
  for (const k of due) {
    await db.update(apiKeys).set({ revokedAt: now }).where(eq(apiKeys.id, k.id));
    await recordKeyEvent(k.id, 'revoked', { meta: { reason: 'grace_expired' } });
  }
  return due;
}
