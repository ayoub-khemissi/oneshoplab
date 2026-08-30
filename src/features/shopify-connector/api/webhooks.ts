/**
 * Webhook registration (needs the custom app's API secret key — without it
 * Shopify's HMAC cannot be verified, so nothing is registered and the
 * connection lives on pulls alone) and the inbound handler behind
 * `POST /api/webhooks/shopify/{projectId}`.
 */
import { createHash } from 'node:crypto';
import { archiveProductBySourceId, syncProjectProducts } from '@/entities/product';
import {
  markTokenInvalid,
  revokeConnection,
  setLastError,
  setWebhookIds,
  touchWebhook,
  withDecryptedToken,
  type DecryptedSecrets
} from '@/entities/shop-connection';
import { getIdempotent, putIdempotent } from '@/shared/api';
import { mapAdminProduct } from '../lib/map-product';
import { SHOPIFY_HMAC_HEADER, verifyShopifyHmac } from '../lib/webhook-hmac';
import {
  createAdminClient,
  ShopifyAdminError,
  type ShopifyAdminClient,
  type WebhookTopic
} from './admin-client';

export const WEBHOOK_TOPICS: readonly WebhookTopic[] = ['PRODUCTS_UPDATE', 'PRODUCTS_DELETE'];
/** Public-app installs also learn about their own removal (custom apps have no such event). */
export const OAUTH_WEBHOOK_TOPICS: readonly WebhookTopic[] = [...WEBHOOK_TOPICS, 'APP_UNINSTALLED'];

export function webhookCallbackUrl(projectId: string): string {
  const base = (process.env.APP_URL ?? '').replace(/\/+$/, '');
  return `${base}/api/webhooks/shopify/${projectId}`;
}

function clientFor(secrets: DecryptedSecrets, make: typeof createAdminClient): ShopifyAdminClient {
  return make({
    shopDomain: secrets.shopDomain,
    accessToken: secrets.accessToken,
    apiVersion: secrets.apiVersion
  });
}

/** Creates both subscriptions; returns the ids or null when no secret was pasted. */
export async function registerShopifyWebhooks(
  projectId: string,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<string[] | null> {
  const ids = await withDecryptedToken(projectId, async (secrets, connection) => {
    if (!secrets.webhookSecret) return null;
    const client = clientFor(secrets, makeClient);
    const url = webhookCallbackUrl(projectId);
    const created: string[] = [];
    const topics = connection.authMode === 'oauth' ? OAUTH_WEBHOOK_TOPICS : WEBHOOK_TOPICS;
    for (const topic of topics) created.push(await client.webhookSubscriptionCreate(topic, url));
    return created;
  });
  if (ids) await setWebhookIds(projectId, ids);
  return ids ?? null;
}

/** Best effort: a failure is logged on the row, never thrown. */
export async function deleteShopifyWebhooks(
  projectId: string,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<void> {
  try {
    await withDecryptedToken(projectId, async (secrets, connection) => {
      const ids = connection.webhookIds ?? [];
      if (ids.length === 0) return;
      const client = clientFor(secrets, makeClient);
      for (const id of ids) await client.webhookSubscriptionDelete(id);
      await setWebhookIds(projectId, null);
    });
  } catch (e) {
    await setLastError(projectId, `webhook cleanup: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface WebhookRequest {
  projectId: string;
  rawBody: string;
  headers: Headers;
}
export interface WebhookOutcome {
  status: 200 | 401 | 404;
  body: { ok: boolean; action?: string; replay?: boolean; error?: string };
}

const IDEMPOTENCY_SCOPE = 'shopify-webhook';

function sourceIdOf(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { id?: unknown; admin_graphql_api_id?: unknown };
    if (typeof parsed.id === 'number' || typeof parsed.id === 'string') return String(parsed.id);
    if (typeof parsed.admin_graphql_api_id === 'string') {
      return parsed.admin_graphql_api_id.split('/').pop() ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

async function applyTopic(
  projectId: string,
  topic: string,
  sourceId: string,
  secrets: DecryptedSecrets,
  makeClient: typeof createAdminClient
): Promise<string> {
  if (topic === 'products/delete') {
    return archiveProductBySourceId(projectId, sourceId);
  }
  if (topic !== 'products/update' && topic !== 'products/create') return 'ignored';
  const client = clientFor(secrets, makeClient);
  const [shop, product] = await Promise.all([client.shopInfo(), client.productById(sourceId)]);
  if (!product) return archiveProductBySourceId(projectId, sourceId);
  const normalized = mapAdminProduct(product, {
    shopDomain: secrets.shopDomain,
    currency: shop.currencyCode
  });
  await syncProjectProducts(projectId, 'shopify', [normalized], { archiveMissing: false });
  return 'upserted';
}

/**
 * HMAC → replay guard (`X-Shopify-Webhook-Id`, 24 h) → one-product sync or
 * archive. Always 200 once authenticated: Shopify retries non-2xx and
 * unsubscribes after repeated failures; a nightly pull repairs any miss.
 */
export async function handleShopifyWebhook(
  req: WebhookRequest,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<WebhookOutcome> {
  const outcome = await withDecryptedToken(
    req.projectId,
    async (secrets): Promise<WebhookOutcome> => {
      if (!secrets.webhookSecret) return { status: 401, body: { ok: false, error: 'no_secret' } };
      if (
        !verifyShopifyHmac(req.rawBody, req.headers.get(SHOPIFY_HMAC_HEADER), secrets.webhookSecret)
      ) {
        return { status: 401, body: { ok: false, error: 'bad_hmac' } };
      }
      await touchWebhook(req.projectId);

      const webhookId = req.headers.get('x-shopify-webhook-id')?.trim() ?? '';
      const bodyHash = createHash('sha256').update(req.rawBody).digest('hex');
      if (webhookId) {
        const seen = await getIdempotent(
          `${IDEMPOTENCY_SCOPE}:${req.projectId}`,
          webhookId,
          bodyHash
        );
        if (seen.kind !== 'miss') return { status: 200, body: { ok: true, replay: true } };
        await putIdempotent(
          `${IDEMPOTENCY_SCOPE}:${req.projectId}`,
          webhookId,
          bodyHash,
          200,
          null
        );
      }

      const topic = req.headers.get('x-shopify-topic')?.trim().toLowerCase() ?? '';
      if (topic === 'app/uninstalled') {
        await revokeConnection(req.projectId, 'app/uninstalled');
        return { status: 200, body: { ok: true, action: 'revoked' } };
      }
      const sourceId = sourceIdOf(req.rawBody);
      if (!sourceId) return { status: 200, body: { ok: true, action: 'ignored' } };
      try {
        const action = await applyTopic(req.projectId, topic, sourceId, secrets, makeClient);
        return { status: 200, body: { ok: true, action } };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (e instanceof ShopifyAdminError && e.code === 'token_invalid') {
          await markTokenInvalid(req.projectId, message);
        } else {
          await setLastError(req.projectId, `webhook ${topic}: ${message}`);
        }
        return { status: 200, body: { ok: false, action: 'failed', error: message } };
      }
    }
  );
  return outcome ?? { status: 404, body: { ok: false, error: 'not_found' } };
}
