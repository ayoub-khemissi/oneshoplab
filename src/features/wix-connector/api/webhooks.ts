/**
 * `POST /api/webhooks/wix` — one endpoint for every event (Wix routes by
 * app, not by site): JWT verified with the app public key, instanceId →
 * connection, then a one-product re-read / archive, or revocation on
 * "App Removed". Always 200 once authenticated (Wix retries non-2xx).
 */
import { createHash } from 'node:crypto';
import { archiveProductBySourceId, syncProjectProducts } from '@/entities/product';
import {
  getConnectionByInstanceId,
  revokeConnection,
  setLastError,
  touchWebhook
} from '@/entities/shop-connection';
import { getIdempotent, putIdempotent } from '@/shared/api';
import { wixAppConfig } from '../lib/config';
import { mapWixProduct } from '../lib/map-product';
import { parseWixWebhookClaims, verifyWixJwt, type WixWebhookEvent } from '../lib/webhook-jwt';
import { createWixClient, WixClientError } from './client';
import { flagTokenInvalid, withWixClient } from './shared';

export interface WixWebhookOutcome {
  status: 200 | 401 | 404;
  body: { ok: boolean; action?: string; replay?: boolean; error?: string };
}

const IDEMPOTENCY_SCOPE = 'wix-webhook';

async function applyEvent(
  projectId: string,
  event: WixWebhookEvent,
  makeClient: typeof createWixClient
): Promise<string> {
  if (event.kind === 'app_removed') {
    await revokeConnection(projectId, 'app removed from the Wix site');
    return 'revoked';
  }
  if (!event.productId) return 'ignored';
  if (event.kind === 'deleted') return archiveProductBySourceId(projectId, event.productId);
  if (event.kind !== 'created' && event.kind !== 'updated') return 'ignored';
  const action = await withWixClient(projectId, makeClient, async (client) => {
    const [product, collections] = await Promise.all([
      client.productById(event.productId ?? ''),
      client.collections()
    ]);
    if (!product) return archiveProductBySourceId(projectId, event.productId ?? '');
    await syncProjectProducts(projectId, 'wix', [mapWixProduct(product, { collections })], {
      archiveMissing: false
    });
    return 'upserted';
  });
  return action ?? 'ignored';
}

export async function handleWixWebhook(
  rawBody: string,
  makeClient: typeof createWixClient = createWixClient
): Promise<WixWebhookOutcome> {
  const cfg = wixAppConfig();
  if (!cfg?.publicKey) return { status: 401, body: { ok: false, error: 'no_public_key' } };
  const claims = verifyWixJwt(rawBody, cfg.publicKey);
  if (!claims) return { status: 401, body: { ok: false, error: 'bad_signature' } };
  const event = parseWixWebhookClaims(claims);
  if (!event) return { status: 200, body: { ok: true, action: 'ignored' } };
  const connection = await getConnectionByInstanceId(event.instanceId);
  if (!connection) return { status: 404, body: { ok: false, error: 'not_found' } };
  const projectId = connection.projectId;
  await touchWebhook(projectId);

  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  const eventId = typeof claims.jti === 'string' ? claims.jti : bodyHash;
  const seen = await getIdempotent(`${IDEMPOTENCY_SCOPE}:${projectId}`, eventId, bodyHash);
  if (seen.kind !== 'miss') return { status: 200, body: { ok: true, replay: true } };
  await putIdempotent(`${IDEMPOTENCY_SCOPE}:${projectId}`, eventId, bodyHash, 200, null);

  try {
    return {
      status: 200,
      body: { ok: true, action: await applyEvent(projectId, event, makeClient) }
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof WixClientError && e.code === 'token_invalid') {
      await flagTokenInvalid(projectId, message);
    } else {
      await setLastError(projectId, `webhook ${event.eventType}: ${message}`);
    }
    return { status: 200, body: { ok: false, action: 'failed', error: message } };
  }
}
