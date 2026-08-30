import { and, eq, exists, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/shared/db';
import {
  productChanges,
  projects,
  shopConnections,
  type ShopPullProgress
} from '@/shared/db/schema';
import { hasSecretBoxKey, openSecret, sealSecret } from '@/shared/lib';
import { normalizeShopDomain } from '../lib/domain';
import type {
  ConnectShopifyInput,
  ConnectShopifyResult,
  DecryptedSecrets,
  ShopConnection,
  ShopConnectionRow
} from '../model/types';

/** Interval between two worker-driven full pulls of one connection. */
export const NIGHTLY_PULL_INTERVAL_MS = 24 * 60 * 60 * 1000;

function toPublic(row: ShopConnectionRow): ShopConnection {
  const { accessTokenCiphertext: _t, webhookSecretCiphertext, ...rest } = row;
  void _t;
  return { ...rest, hasWebhookSecret: !!webhookSecretCiphertext };
}

async function ownedProject(projectId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return !!row;
}

async function getRow(projectId: string): Promise<ShopConnectionRow | null> {
  const [row] = await db
    .select()
    .from(shopConnections)
    .where(eq(shopConnections.projectId, projectId));
  return row ?? null;
}

/**
 * Save (or replace) the token of a project. The caller has already validated
 * the token against Shopify (features/shopify-connector `validate.ts`); this
 * only checks ownership + domain format, seals the secrets and upserts.
 */
export async function connectShopify(input: ConnectShopifyInput): Promise<ConnectShopifyResult> {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  if (!shopDomain) return { ok: false, reason: 'invalid_domain' };
  const accessToken = input.accessToken.trim();
  if (accessToken.length < 20 || /\s/.test(accessToken))
    return { ok: false, reason: 'invalid_token' };
  if (!hasSecretBoxKey()) return { ok: false, reason: 'no_key' };
  if (!(await ownedProject(input.projectId, input.userId)))
    return { ok: false, reason: 'not_found' };

  const apiSecret = input.apiSecret?.trim() || null;
  const values = {
    shopDomain,
    shopName: input.shopName ?? null,
    accessTokenCiphertext: sealSecret(accessToken),
    keyId: 'v1',
    scopes: input.scopes ?? [],
    apiVersion: input.apiVersion,
    webhookSecretCiphertext: apiSecret ? sealSecret(apiSecret) : null,
    webhookIds: null,
    status: 'connected' as const,
    lastError: null,
    revokedAt: null
  };
  const existing = await getRow(input.projectId);
  if (existing) {
    await db.update(shopConnections).set(values).where(eq(shopConnections.id, existing.id));
  } else {
    await db
      .insert(shopConnections)
      .values({ id: randomUUID(), projectId: input.projectId, ...values });
  }
  const row = await getRow(input.projectId);
  if (!row) return { ok: false, reason: 'not_found' };
  return { ok: true, connection: toPublic(row) };
}

export async function getConnection(projectId: string): Promise<ShopConnection | null> {
  const row = await getRow(projectId);
  return row ? toPublic(row) : null;
}

/** Owner-scoped read for server actions / views. */
export async function getConnectionForUser(
  projectId: string,
  userId: string
): Promise<ShopConnection | null> {
  if (!(await ownedProject(projectId, userId))) return null;
  return getConnection(projectId);
}

/**
 * The only way to reach the plaintext: scoped to `fn`, never returned.
 * Null when there is no usable connection (missing or revoked).
 */
export async function withDecryptedToken<T>(
  projectId: string,
  fn: (secrets: DecryptedSecrets, connection: ShopConnection) => Promise<T>
): Promise<T | null> {
  const row = await getRow(projectId);
  if (!row || row.status === 'revoked' || !row.accessTokenCiphertext) return null;
  const secrets: DecryptedSecrets = {
    shopDomain: row.shopDomain,
    accessToken: openSecret(row.accessTokenCiphertext),
    webhookSecret: row.webhookSecretCiphertext ? openSecret(row.webhookSecretCiphertext) : null,
    apiVersion: row.apiVersion
  };
  return fn(secrets, toPublic(row));
}

/** 401 from Shopify: no retries until a new token is saved. */
export async function markTokenInvalid(projectId: string, error: string): Promise<void> {
  await db
    .update(shopConnections)
    .set({ status: 'token_invalid', lastError: error.slice(0, 2000) })
    .where(and(eq(shopConnections.projectId, projectId), eq(shopConnections.status, 'connected')));
}

export async function setLastError(projectId: string, error: string | null): Promise<void> {
  await db
    .update(shopConnections)
    .set({ lastError: error?.slice(0, 2000) ?? null })
    .where(eq(shopConnections.projectId, projectId));
}

export async function setPullProgress(
  projectId: string,
  progress: ShopPullProgress | null,
  extra: { lastPullAt?: Date; clearRequest?: boolean } = {}
): Promise<void> {
  await db
    .update(shopConnections)
    .set({
      pullProgress: progress,
      ...(extra.lastPullAt ? { lastPullAt: extra.lastPullAt } : {}),
      ...(extra.clearRequest ? { pullRequestedAt: null } : {})
    })
    .where(eq(shopConnections.projectId, projectId));
}

/** Connect flow / "Synchroniser": the worker pulls on its next tick. */
export async function requestPull(projectId: string): Promise<void> {
  await db
    .update(shopConnections)
    .set({ pullRequestedAt: new Date() })
    .where(and(eq(shopConnections.projectId, projectId), eq(shopConnections.status, 'connected')));
}

export async function setWebhookIds(projectId: string, ids: string[] | null): Promise<void> {
  await db
    .update(shopConnections)
    .set({ webhookIds: ids })
    .where(eq(shopConnections.projectId, projectId));
}

export async function touchWebhook(projectId: string): Promise<void> {
  await db
    .update(shopConnections)
    .set({ lastWebhookAt: new Date() })
    .where(eq(shopConnections.projectId, projectId));
}

/** Wipes both ciphertexts; the row stays so the card can say "déconnecté". */
export async function disconnect(projectId: string, userId: string): Promise<boolean> {
  if (!(await ownedProject(projectId, userId))) return false;
  const [res] = await db
    .update(shopConnections)
    .set({
      accessTokenCiphertext: '',
      webhookSecretCiphertext: null,
      webhookIds: null,
      status: 'revoked',
      revokedAt: new Date(),
      pullRequestedAt: null
    })
    .where(eq(shopConnections.projectId, projectId));
  return res.affectedRows > 0;
}

/** Connected projects that have at least one pending change (cheap tick query). */
export async function listForApply(): Promise<ShopConnection[]> {
  const rows = await db
    .select()
    .from(shopConnections)
    .where(
      and(
        eq(shopConnections.status, 'connected'),
        exists(
          db
            .select({ id: productChanges.id })
            .from(productChanges)
            .where(
              and(
                eq(productChanges.projectId, shopConnections.projectId),
                eq(productChanges.status, 'pending')
              )
            )
        )
      )
    );
  return rows.map(toPublic);
}

/** Connections with an explicit pull request (connect / "Synchroniser"). */
export async function listRequestedPulls(): Promise<ShopConnection[]> {
  const rows = await db
    .select()
    .from(shopConnections)
    .where(
      and(eq(shopConnections.status, 'connected'), isNotNull(shopConnections.pullRequestedAt))
    );
  return rows.map(toPublic);
}

/** Connections whose last full pull is older than 24 h (or never ran). */
export async function listDueNightlyPulls(now: Date = new Date()): Promise<ShopConnection[]> {
  const cutoff = new Date(now.getTime() - NIGHTLY_PULL_INTERVAL_MS);
  const rows = await db
    .select()
    .from(shopConnections)
    .where(
      and(
        eq(shopConnections.status, 'connected'),
        or(isNull(shopConnections.lastPullAt), lt(shopConnections.lastPullAt, cutoff))
      )
    );
  return rows.map(toPublic);
}
