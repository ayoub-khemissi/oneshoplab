/**
 * Webhook registration (needs the custom app's API secret key — without it
 * Shopify's HMAC cannot be verified, so nothing is registered and the
 * connection lives on pulls alone) and the inbound handler behind
 * `POST /api/webhooks/shopify/{projectId}`.
 */
import { createHash } from 'node:crypto';
import { archiveProductBySourceId, syncProjectProducts } from '@/entities/product';
import {
  getConnection,
  getShopifyShop,
  markTokenInvalid,
  normalizeShopDomain,
  revokeConnection,
  setLastError,
  setWebhookIds,
  touchWebhook,
  withDecryptedToken,
  type DecryptedSecrets
} from '@/entities/shop-connection';
import { getIdempotent, putIdempotent } from '@/shared/api';
import { mapAdminProduct } from '../lib/map-product';
import { shopifyAppConfig } from '../lib/oauth';
import { SHOPIFY_HMAC_HEADER, verifyShopifyHmac } from '../lib/webhook-hmac';
import {
  createAdminClient,
  ShopifyAdminError,
  type ShopifyAdminClient,
  type WebhookTopic
} from './admin-client';
import { shopifyTokenProvider } from './token';
import { handleShopifyBillingWebhook, onShopifyAppUninstalled } from './app-billing';

export const WEBHOOK_TOPICS: readonly WebhookTopic[] = ['PRODUCTS_UPDATE', 'PRODUCTS_DELETE'];
/** Public-app installs also learn about their own removal (custom apps have no such event). */
export const OAUTH_WEBHOOK_TOPICS: readonly WebhookTopic[] = [
  ...WEBHOOK_TOPICS,
  'APP_UNINSTALLED',
  // Shopify Billing (App Store installs): plan approvals, cancellations and
  // pack purchases the merchant confirmed after closing our page.
  'APP_SUBSCRIPTIONS_UPDATE',
  'APP_PURCHASES_ONE_TIME_UPDATE'
];

export function webhookCallbackUrl(projectId: string): string {
  const base = (process.env.APP_URL ?? '').replace(/\/+$/, '');
  return `${base}/api/webhooks/shopify/${projectId}`;
}

function clientFor(
  projectId: string,
  secrets: DecryptedSecrets,
  make: typeof createAdminClient
): ShopifyAdminClient {
  return make({
    shopDomain: secrets.shopDomain,
    accessToken: secrets.accessToken,
    tokenProvider: shopifyTokenProvider(projectId, secrets),
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
    const client = clientFor(projectId, secrets, makeClient);
    const url = webhookCallbackUrl(projectId);
    const created: string[] = [];
    const topics = connection.authMode === 'oauth' ? OAUTH_WEBHOOK_TOPICS : WEBHOOK_TOPICS;
    for (const topic of topics) {
      try {
        created.push(await client.webhookSubscriptionCreate(topic, url));
      } catch (e) {
        // One topic Shopify refuses — most often because a subscription for it
        // already exists from an earlier install — must not throw away the ids
        // of the ones that worked. Untracked subscriptions are the ones we can
        // never delete, and they keep hammering a dead URL after a disconnect.
        console.error('[shopify] webhook create failed', topic, (e as Error).message);
      }
    }
    return created;
  });
  if (ids && ids.length > 0) await setWebhookIds(projectId, ids);
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
      const client = clientFor(projectId, secrets, makeClient);
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
  status: 200 | 400 | 401 | 404;
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
  const client = clientFor(projectId, secrets, makeClient);
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
        await onShopifyAppUninstalled(secrets.shopDomain);
        return { status: 200, body: { ok: true, action: 'revoked' } };
      }
      if (topic === 'app_subscriptions/update' || topic === 'app_purchases_one_time/update') {
        const action = await handleShopifyBillingWebhook(secrets.shopDomain, topic, req.rawBody);
        return { status: 200, body: { ok: true, action } };
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
  if (outcome) return outcome;

  // No live connection for this project. A subscription we deliberately dropped
  // — the merchant disconnected — is not an error on Shopify's side, and a 404
  // only buys six retries per product change against a URL that will never
  // answer. Acknowledge it so the noise stops; a URL that never had a
  // connection at all still gets a 404, because that one IS a misconfiguration.
  const known = await getConnection(req.projectId);
  if (known) return { status: 200, body: { ok: true, action: 'disconnected' } };
  // A deleted site takes its connection row with it, but its subscriptions
  // live on in Shopify. Signed by our app: acknowledge, or Shopify retries
  // every event and counts each one as a failed delivery.
  const cfg = shopifyAppConfig();
  if (
    cfg &&
    verifyShopifyHmac(req.rawBody, req.headers.get(SHOPIFY_HMAC_HEADER), cfg.clientSecret)
  ) {
    return { status: 200, body: { ok: true, action: 'gone' } };
  }
  return { status: 404, body: { ok: false, error: 'not_found' } };
}

/**
 * App-level subscriptions declared in shopify.app.toml (`/api/webhooks/shopify/app`).
 * Unlike the per-project ones above they exist for every shop that installed
 * the app, linked to an account or not, and are signed with the client secret.
 * Every action is idempotent: the per-project copy of the same event may
 * arrive too.
 */
export async function handleShopifyAppWebhook(req: {
  rawBody: string;
  headers: Headers;
}): Promise<WebhookOutcome> {
  const cfg = shopifyAppConfig();
  if (!cfg) return { status: 401, body: { ok: false, error: 'not_configured' } };
  if (!verifyShopifyHmac(req.rawBody, req.headers.get(SHOPIFY_HMAC_HEADER), cfg.clientSecret)) {
    return { status: 401, body: { ok: false, error: 'bad_hmac' } };
  }
  const shop = normalizeShopDomain(req.headers.get('x-shopify-shop-domain') ?? '');
  if (!shop) return { status: 400, body: { ok: false, error: 'bad_shop' } };
  const topic = req.headers.get('x-shopify-topic')?.trim().toLowerCase() ?? '';
  if (topic === 'app/uninstalled') {
    const row = await getShopifyShop(shop);
    if (row?.projectId) {
      const connection = await getConnection(row.projectId);
      if (connection?.platform === 'shopify' && connection.shopDomain === shop) {
        await revokeConnection(row.projectId, 'app/uninstalled');
      }
    }
    await onShopifyAppUninstalled(shop);
    return { status: 200, body: { ok: true, action: 'revoked' } };
  }
  if (topic === 'app_subscriptions/update' || topic === 'app_purchases_one_time/update') {
    const action = await handleShopifyBillingWebhook(shop, topic, req.rawBody);
    return { status: 200, body: { ok: true, action } };
  }
  return { status: 200, body: { ok: true, action: 'ignored' } };
}
