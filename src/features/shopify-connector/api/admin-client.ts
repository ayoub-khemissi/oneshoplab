/**
 * Minimal Admin GraphQL client (fetch, no SDK). One instance per
 * (shop, token) pair; keeps the last throttle status so consecutive calls
 * wait for the leaky bucket instead of being refused with THROTTLED.
 * 401 → `token_invalid` (the caller flips the connection status).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import {
  MAX_SINGLE_QUERY_COST,
  projectStatus,
  throttleDelayMs,
  type CostExtension,
  type ThrottleStatus
} from '../lib/throttle';
import {
  PRODUCTS_PAGE_SIZE,
  PRODUCT_FIELDS_FRAGMENT,
  productGid,
  type AdminProduct
} from '../lib/map-product';

export const SHOPIFY_API_VERSION = '2025-07';
const THROTTLED_RETRIES = 3;

export type ShopifyAdminErrorCode =
  'token_invalid' | 'http' | 'graphql' | 'user_errors' | 'network';

export class ShopifyAdminError extends Error {
  constructor(
    public readonly code: ShopifyAdminErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ShopifyAdminError';
  }
}

export interface ShopInfo {
  name: string;
  myshopifyDomain: string;
  currencyCode: string | null;
  /** Access scopes granted to the custom app. */
  scopes: string[];
}

export interface ProductsPage {
  products: AdminProduct[];
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface ProductUpdateInput {
  id: string;
  title?: string;
  descriptionHtml?: string;
  tags?: string[];
}

export interface CreateMediaInput {
  originalSource: string;
  alt: string | null;
}

export type WebhookTopic = 'PRODUCTS_UPDATE' | 'PRODUCTS_DELETE' | 'APP_UNINSTALLED';

interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}
interface GraphQLEnvelope<T> {
  data?: T;
  errors?: GraphQLError[];
  extensions?: { cost?: CostExtension };
}
interface UserError {
  field: string[] | null;
  message: string;
}

export interface AdminClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<unknown>;
}

export interface ShopifyAdminClient {
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  shopInfo(): Promise<ShopInfo>;
  productsPage(cursor: string | null): Promise<ProductsPage>;
  productById(sourceIdOrGid: string): Promise<AdminProduct | null>;
  productUpdate(input: ProductUpdateInput): Promise<void>;
  productCreateMedia(sourceIdOrGid: string, media: CreateMediaInput[]): Promise<void>;
  webhookSubscriptionCreate(topic: WebhookTopic, callbackUrl: string): Promise<string>;
  webhookSubscriptionDelete(id: string): Promise<void>;
  /** Last throttle status seen (tests + progress UI). */
  throttle(): ThrottleStatus | null;
}

function assertNoUserErrors(errors: UserError[] | undefined, op: string): void {
  if (errors && errors.length > 0) {
    const msg = errors.map((e) => `${(e.field ?? []).join('.') || '-'}: ${e.message}`).join('; ');
    throw new ShopifyAdminError('user_errors', `${op}: ${msg}`);
  }
}

export function createAdminClient(opts: AdminClientOptions): ShopifyAdminClient {
  const apiVersion = opts.apiVersion ?? SHOPIFY_API_VERSION;
  const url = `https://${opts.shopDomain}/admin/api/${apiVersion}/graphql.json`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl ?? ((ms: number) => sleep(ms));
  let lastStatus: ThrottleStatus | null = null;
  let lastStatusAt = 0;
  let lastRequestedCost = MAX_SINGLE_QUERY_COST;
  let justBackedOff = false;

  async function waitForBudget(): Promise<void> {
    if (justBackedOff) {
      justBackedOff = false;
      return;
    }
    if (!lastStatus) return;
    const projected = projectStatus(lastStatus, Date.now() - lastStatusAt);
    const delay = throttleDelayMs(projected, lastRequestedCost);
    if (delay > 0) await sleepImpl(delay);
  }

  async function request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await waitForBudget();
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-shopify-access-token': opts.accessToken
          },
          body: JSON.stringify({ query, variables })
        });
      } catch (e) {
        throw new ShopifyAdminError('network', `Shopify unreachable: ${(e as Error).message}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new ShopifyAdminError(
          'token_invalid',
          `Shopify refused the token (${res.status})`,
          res.status
        );
      }
      if (res.status === 429 && attempt < THROTTLED_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2;
        await sleepImpl(retryAfter * 1000);
        continue;
      }
      if (!res.ok) {
        throw new ShopifyAdminError('http', `Shopify HTTP ${res.status}`, res.status);
      }
      const body = (await res.json()) as GraphQLEnvelope<T>;
      const cost = body.extensions?.cost;
      if (cost?.throttleStatus) {
        lastStatus = cost.throttleStatus;
        lastStatusAt = Date.now();
        lastRequestedCost = cost.requestedQueryCost || lastRequestedCost;
      }
      if (body.errors?.length) {
        const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (throttled && attempt < THROTTLED_RETRIES) {
          await sleepImpl(Math.max(1000, throttleDelayMs(lastStatus, lastRequestedCost)));
          justBackedOff = true;
          continue;
        }
        throw new ShopifyAdminError('graphql', body.errors.map((e) => e.message).join('; '));
      }
      if (!body.data) throw new ShopifyAdminError('graphql', 'Empty GraphQL response');
      return body.data;
    }
  }

  return {
    request,
    throttle: () => lastStatus,

    async shopInfo() {
      const data = await request<{
        shop: Omit<ShopInfo, 'scopes'>;
        currentAppInstallation: { accessScopes: Array<{ handle: string }> } | null;
      }>(
        `query OslShop {
  shop { name myshopifyDomain currencyCode }
  currentAppInstallation { accessScopes { handle } }
}`
      );
      return {
        ...data.shop,
        scopes: (data.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle)
      };
    },

    async productsPage(cursor) {
      const data = await request<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: AdminProduct[];
        };
      }>(
        `${PRODUCT_FIELDS_FRAGMENT}
query OslProducts($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes { ...OslProduct }
  }
}`,
        { first: PRODUCTS_PAGE_SIZE, after: cursor }
      );
      return {
        products: data.products.nodes,
        endCursor: data.products.pageInfo.endCursor,
        hasNextPage: data.products.pageInfo.hasNextPage
      };
    },

    async productById(id) {
      const data = await request<{ product: AdminProduct | null }>(
        `${PRODUCT_FIELDS_FRAGMENT}
query OslProduct($id: ID!) { product(id: $id) { ...OslProduct } }`,
        { id: productGid(id) }
      );
      return data.product;
    },

    async productUpdate(input) {
      const data = await request<{ productUpdate: { userErrors: UserError[] } }>(
        `mutation OslProductUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id } userErrors { field message } }
}`,
        { product: { ...input, id: productGid(input.id) } }
      );
      assertNoUserErrors(data.productUpdate.userErrors, 'productUpdate');
    },

    async productCreateMedia(id, media) {
      const data = await request<{ productCreateMedia: { mediaUserErrors: UserError[] } }>(
        `mutation OslProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { id } mediaUserErrors { field message }
  }
}`,
        {
          productId: productGid(id),
          media: media.map((m) => ({
            originalSource: m.originalSource,
            alt: m.alt ?? undefined,
            mediaContentType: 'IMAGE'
          }))
        }
      );
      assertNoUserErrors(data.productCreateMedia.mediaUserErrors, 'productCreateMedia');
    },

    async webhookSubscriptionCreate(topic, callbackUrl) {
      const data = await request<{
        webhookSubscriptionCreate: {
          webhookSubscription: { id: string } | null;
          userErrors: UserError[];
        };
      }>(
        `mutation OslWebhookCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
    webhookSubscription { id } userErrors { field message }
  }
}`,
        { topic, sub: { uri: callbackUrl, format: 'JSON' } }
      );
      assertNoUserErrors(data.webhookSubscriptionCreate.userErrors, 'webhookSubscriptionCreate');
      const id = data.webhookSubscriptionCreate.webhookSubscription?.id;
      if (!id) throw new ShopifyAdminError('graphql', 'webhookSubscriptionCreate returned no id');
      return id;
    },

    async webhookSubscriptionDelete(id) {
      const data = await request<{ webhookSubscriptionDelete: { userErrors: UserError[] } }>(
        `mutation OslWebhookDelete($id: ID!) {
  webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } }
}`,
        { id }
      );
      assertNoUserErrors(data.webhookSubscriptionDelete.userErrors, 'webhookSubscriptionDelete');
    }
  };
}
