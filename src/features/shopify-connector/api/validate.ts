/**
 * Connect flow (wizard step 4): validate the pasted token against
 * `shop { name }`, seal + store it, register webhooks when the API secret
 * was pasted too, and queue the first full pull for the worker.
 */
import {
  connectShopify,
  disconnect,
  normalizeShopDomain,
  requestPull,
  setLastError,
  type ConnectShopifyResult,
  type ShopConnection
} from '@/entities/shop-connection';
import { createAdminClient, SHOPIFY_API_VERSION, ShopifyAdminError } from './admin-client';
import { deleteShopifyWebhooks, registerShopifyWebhooks } from './webhooks';

export interface ConnectShopifyStoreInput {
  projectId: string;
  userId: string;
  shopDomain: string;
  accessToken: string;
  /** Custom-app "API secret key" (optional → no webhooks, pulls only). */
  apiSecret?: string | null;
}

export type ConnectShopifyStoreResult =
  | {
      ok: true;
      connection: ShopConnection;
      shopName: string;
      webhooks: 'registered' | 'skipped' | 'failed';
    }
  | { ok: false; reason: ConnectFailure; error?: string };

export type ConnectFailure =
  | Extract<ConnectShopifyResult, { ok: false }>['reason']
  | 'token_invalid'
  | 'unreachable'
  | 'domain_mismatch';

export async function connectShopifyStore(
  input: ConnectShopifyStoreInput,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<ConnectShopifyStoreResult> {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  if (!shopDomain) return { ok: false, reason: 'invalid_domain' };
  const accessToken = input.accessToken.trim();

  let shop: Awaited<ReturnType<ReturnType<typeof makeClient>['shopInfo']>>;
  try {
    shop = await makeClient({ shopDomain, accessToken }).shopInfo();
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (e instanceof ShopifyAdminError && e.code === 'token_invalid') {
      return { ok: false, reason: 'token_invalid', error };
    }
    return { ok: false, reason: 'unreachable', error };
  }
  if (shop.myshopifyDomain && shop.myshopifyDomain.toLowerCase() !== shopDomain) {
    return { ok: false, reason: 'domain_mismatch', error: shop.myshopifyDomain };
  }

  const saved = await connectShopify({
    projectId: input.projectId,
    userId: input.userId,
    shopDomain,
    accessToken,
    apiSecret: input.apiSecret ?? null,
    shopName: shop.name,
    scopes: shop.scopes,
    apiVersion: SHOPIFY_API_VERSION
  });
  if (!saved.ok) return saved;

  let webhooks: 'registered' | 'skipped' | 'failed' = 'skipped';
  if (input.apiSecret?.trim()) {
    try {
      webhooks = (await registerShopifyWebhooks(input.projectId, makeClient))
        ? 'registered'
        : 'skipped';
    } catch (e) {
      webhooks = 'failed';
      await setLastError(
        input.projectId,
        `webhook registration: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  await requestPull(input.projectId);
  return { ok: true, connection: saved.connection, shopName: shop.name, webhooks };
}

/** "Disconnect": webhooks removed best effort, token wiped, status `revoked`. */
export async function disconnectShopifyStore(
  projectId: string,
  userId: string,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<boolean> {
  await deleteShopifyWebhooks(projectId, makeClient);
  return disconnect(projectId, userId);
}

/** "Synchroniser" button: the worker runs the pull on its next tick. */
export async function requestShopifyPull(projectId: string): Promise<void> {
  await requestPull(projectId);
}
