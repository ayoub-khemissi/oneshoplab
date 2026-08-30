import { and, eq, exists, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { emitProjectEvent } from '@/entities/outbound-webhook';
import { db } from '@/shared/db';
import {
  productChanges,
  projects,
  shopConnections,
  type ShopConnectionPlatform,
  type ShopPullProgress
} from '@/shared/db/schema';
import { hasSecretBoxKey, openSecret, sealSecret } from '@/shared/lib';
import { normalizeShopDomain } from '../lib/domain';
import type {
  ConnectShopifyInput,
  ConnectShopifyResult,
  ConnectWixInput,
  ConnectWixResult,
  DecryptedSecrets,
  DecryptedWixSecrets,
  ShopConnection,
  ShopConnectionRow
} from '../model/types';

/** Best-effort webhook event (spec: `connection.status_changed`). */
async function emitStatus(
  projectId: string,
  platform: ShopConnectionPlatform,
  status: ShopConnectionRow['status'],
  reason?: string
): Promise<void> {
  await emitProjectEvent(projectId, 'connection.status_changed', {
    platform,
    status,
    changedAt: new Date().toISOString(),
    ...(reason ? { reason: reason.slice(0, 500) } : {})
  });
}

/** Interval between two worker-driven full pulls of one connection. */
export const NIGHTLY_PULL_INTERVAL_MS = 24 * 60 * 60 * 1000;

function toPublic(row: ShopConnectionRow): ShopConnection {
  const {
    accessTokenCiphertext: _t,
    refreshTokenCiphertext: _r,
    webhookSecretCiphertext,
    ...rest
  } = row;
  void _t;
  void _r;
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
  const authMode = input.authMode ?? 'custom_app';
  const row = await upsert(input.projectId, {
    platform: 'shopify',
    shopDomain,
    shopName: input.shopName ?? null,
    accessTokenCiphertext: sealSecret(accessToken),
    refreshTokenCiphertext: null,
    instanceId: null,
    keyId: 'v1',
    scopes: input.scopes ?? [],
    apiVersion: input.apiVersion,
    authMode,
    installedViaOauthAt: authMode === 'oauth' ? new Date() : null,
    webhookSecretCiphertext: apiSecret ? sealSecret(apiSecret) : null
  });
  if (!row) return { ok: false, reason: 'not_found' };
  return { ok: true, connection: toPublic(row) };
}

/** Wix app install: the refresh token is the durable secret (access tokens live 5 min). */
export async function connectWix(input: ConnectWixInput): Promise<ConnectWixResult> {
  const refreshToken = input.refreshToken.trim();
  const instanceId = input.instanceId.trim();
  if (refreshToken.length < 20 || /\s/.test(refreshToken) || !instanceId)
    return { ok: false, reason: 'invalid_token' };
  if (!hasSecretBoxKey()) return { ok: false, reason: 'no_key' };
  if (!(await ownedProject(input.projectId, input.userId)))
    return { ok: false, reason: 'not_found' };
  const row = await upsert(input.projectId, {
    platform: 'wix',
    shopDomain: input.shopDomain.trim().toLowerCase().slice(0, 255) || instanceId,
    shopName: input.shopName ?? null,
    accessTokenCiphertext: '',
    refreshTokenCiphertext: sealSecret(refreshToken),
    instanceId,
    keyId: 'v1',
    scopes: input.scopes ?? [],
    apiVersion: 'v1',
    authMode: 'oauth',
    installedViaOauthAt: new Date(),
    webhookSecretCiphertext: null
  });
  if (!row) return { ok: false, reason: 'not_found' };
  return { ok: true, connection: toPublic(row) };
}

type UpsertValues = Pick<
  typeof shopConnections.$inferInsert,
  | 'platform'
  | 'shopDomain'
  | 'shopName'
  | 'accessTokenCiphertext'
  | 'refreshTokenCiphertext'
  | 'instanceId'
  | 'keyId'
  | 'scopes'
  | 'apiVersion'
  | 'authMode'
  | 'installedViaOauthAt'
  | 'webhookSecretCiphertext'
>;

/** One row per project: a reconnect (any platform) replaces the previous connection. */
async function upsert(projectId: string, values: UpsertValues): Promise<ShopConnectionRow | null> {
  const reset = {
    ...values,
    webhookIds: null,
    status: 'connected' as const,
    lastError: null,
    // A fresh token re-arms the token_invalid alert.
    lastAlertKind: null,
    lastAlertAt: null,
    revokedAt: null
  };
  const existing = await getRow(projectId);
  if (existing) {
    await db.update(shopConnections).set(reset).where(eq(shopConnections.id, existing.id));
  } else {
    await db.insert(shopConnections).values({ id: randomUUID(), projectId, ...reset });
  }
  const row = await getRow(projectId);
  if (row) await emitStatus(projectId, row.platform, 'connected');
  return row;
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
  if (row.platform !== 'shopify') return null;
  const secrets: DecryptedSecrets = {
    shopDomain: row.shopDomain,
    accessToken: openSecret(row.accessTokenCiphertext),
    webhookSecret: row.webhookSecretCiphertext ? openSecret(row.webhookSecretCiphertext) : null,
    apiVersion: row.apiVersion
  };
  return fn(secrets, toPublic(row));
}

/** Wix twin of `withDecryptedToken`: refresh token + instance id, scoped to `fn`. */
export async function withDecryptedWixSecrets<T>(
  projectId: string,
  fn: (secrets: DecryptedWixSecrets, connection: ShopConnection) => Promise<T>
): Promise<T | null> {
  const row = await getRow(projectId);
  if (!row || row.platform !== 'wix' || row.status === 'revoked') return null;
  if (!row.refreshTokenCiphertext || !row.instanceId) return null;
  return fn(
    { instanceId: row.instanceId, refreshToken: openSecret(row.refreshTokenCiphertext) },
    toPublic(row)
  );
}

/** Wix webhooks only carry the app instance id. */
export async function getConnectionByInstanceId(
  instanceId: string
): Promise<ShopConnection | null> {
  const [row] = await db
    .select()
    .from(shopConnections)
    .where(and(eq(shopConnections.instanceId, instanceId), eq(shopConnections.platform, 'wix')));
  return row ? toPublic(row) : null;
}

/**
 * 401 from Shopify: no retries until a new token is saved. True only for the
 * call that flipped `connected` → `token_invalid` — the caller alerts the
 * merchant on that one, never on the retries.
 */
export async function markTokenInvalid(projectId: string, error: string): Promise<boolean> {
  const [res] = await db
    .update(shopConnections)
    .set({ status: 'token_invalid', lastError: error.slice(0, 2000) })
    .where(and(eq(shopConnections.projectId, projectId), eq(shopConnections.status, 'connected')));
  if (res.affectedRows > 0) {
    const row = await getRow(projectId);
    if (row) await emitStatus(projectId, row.platform, 'token_invalid', error);
  }
  return res.affectedRows > 0;
}

/**
 * Reserve the right to send one alert of `kind` for this connection: true
 * when the last alert was a different kind, or the same kind older than
 * `minIntervalMs`. Stamps `last_alert_*` atomically in the same UPDATE so
 * two worker branches (nightly + requested pull) cannot both send.
 */
export async function claimConnectionAlert(
  projectId: string,
  kind: string,
  minIntervalMs: number,
  now: Date = new Date()
): Promise<boolean> {
  const [res] = await db
    .update(shopConnections)
    .set({ lastAlertKind: kind, lastAlertAt: now })
    .where(
      and(
        eq(shopConnections.projectId, projectId),
        or(
          isNull(shopConnections.lastAlertKind),
          ne(shopConnections.lastAlertKind, kind),
          isNull(shopConnections.lastAlertAt),
          lt(shopConnections.lastAlertAt, new Date(now.getTime() - minIntervalMs))
        )
      )
    );
  return res.affectedRows > 0;
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

const REVOKED_VALUES = {
  accessTokenCiphertext: '',
  refreshTokenCiphertext: null,
  webhookSecretCiphertext: null,
  webhookIds: null,
  status: 'revoked' as const,
  pullRequestedAt: null
};

/** Wipes every ciphertext; the row stays so the card can say "déconnecté". */
export async function disconnect(projectId: string, userId: string): Promise<boolean> {
  if (!(await ownedProject(projectId, userId))) return false;
  const [res] = await db
    .update(shopConnections)
    .set({ ...REVOKED_VALUES, revokedAt: new Date() })
    .where(eq(shopConnections.projectId, projectId));
  await emitRevoked(projectId, 'disconnected');
  return res.affectedRows > 0;
}

/** Store-initiated revocation (app uninstalled / removed): no owner check, reason kept. */
export async function revokeConnection(projectId: string, reason: string): Promise<boolean> {
  const [res] = await db
    .update(shopConnections)
    .set({ ...REVOKED_VALUES, revokedAt: new Date(), lastError: reason.slice(0, 2000) })
    .where(eq(shopConnections.projectId, projectId));
  await emitRevoked(projectId, reason);
  return res.affectedRows > 0;
}

async function emitRevoked(projectId: string, reason: string): Promise<void> {
  const row = await getRow(projectId);
  if (row) await emitStatus(projectId, row.platform, 'revoked', reason);
}

/** Shopify `shop/redact`: every connection of that shop, whatever the project. */
export async function revokeByShopDomain(shopDomain: string, reason: string): Promise<number> {
  const affected = await db
    .select({ projectId: shopConnections.projectId })
    .from(shopConnections)
    .where(
      and(
        eq(shopConnections.shopDomain, shopDomain),
        eq(shopConnections.platform, 'shopify'),
        ne(shopConnections.status, 'revoked')
      )
    );
  const [res] = await db
    .update(shopConnections)
    .set({ ...REVOKED_VALUES, revokedAt: new Date(), lastError: reason.slice(0, 2000) })
    .where(
      and(eq(shopConnections.shopDomain, shopDomain), eq(shopConnections.platform, 'shopify'))
    );
  for (const c of affected) await emitStatus(c.projectId, 'shopify', 'revoked', reason);
  return res.affectedRows;
}

/** Connected projects that have at least one pending change (cheap tick query). */
export async function listForApply(
  platform: ShopConnectionPlatform = 'shopify'
): Promise<ShopConnection[]> {
  const rows = await db
    .select()
    .from(shopConnections)
    .where(
      and(
        eq(shopConnections.status, 'connected'),
        eq(shopConnections.platform, platform),
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
export async function listRequestedPulls(
  platform: ShopConnectionPlatform = 'shopify'
): Promise<ShopConnection[]> {
  const rows = await db
    .select()
    .from(shopConnections)
    .where(
      and(
        eq(shopConnections.status, 'connected'),
        eq(shopConnections.platform, platform),
        isNotNull(shopConnections.pullRequestedAt)
      )
    );
  return rows.map(toPublic);
}

/** Connections whose last full pull is older than 24 h (or never ran). */
export async function listDueNightlyPulls(
  now: Date = new Date(),
  platform: ShopConnectionPlatform = 'shopify'
): Promise<ShopConnection[]> {
  const cutoff = new Date(now.getTime() - NIGHTLY_PULL_INTERVAL_MS);
  const rows = await db
    .select()
    .from(shopConnections)
    .where(
      and(
        eq(shopConnections.status, 'connected'),
        eq(shopConnections.platform, platform),
        or(isNull(shopConnections.lastPullAt), lt(shopConnections.lastPullAt, cutoff))
      )
    );
  return rows.map(toPublic);
}
