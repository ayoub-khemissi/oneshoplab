/**
 * Worker step: pending `product_changes` of connected projects are written
 * to Shopify through the shared apply loop (entities/product-change):
 * re-read → `priorValueHash` check → `productUpdate` / `productCreateMedia`
 * → ack.
 */
import {
  applyPendingChanges,
  type ApplyOutcome,
  type ApplyProjectResult,
  type ProductChangeRow
} from '@/entities/product-change';
import { listForApply, markTokenInvalid, withDecryptedToken } from '@/entities/shop-connection';
import { mapAdminProduct } from '../lib/map-product';
import {
  createAdminClient,
  ShopifyAdminError,
  type CreateMediaInput,
  type ShopifyAdminClient
} from './admin-client';
import { alertTokenInvalid } from './alerts';

export type { ApplyOutcome, ApplyProjectResult };

/** Changes handled per project per tick — bounds tick latency. */
export const APPLY_BATCH = 25;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function imageInputs(value: unknown): CreateMediaInput[] {
  if (!Array.isArray(value)) throw new Error('images value must be an array');
  return value.map((v) => {
    const item = v as { src?: unknown; alt?: unknown };
    if (typeof item?.src !== 'string') throw new Error('image value without src');
    return { originalSource: item.src, alt: typeof item.alt === 'string' ? item.alt : null };
  });
}

async function writeChange(client: ShopifyAdminClient, change: ProductChangeRow): Promise<void> {
  const id = change.productSourceId;
  switch (change.field) {
    case 'title':
      if (typeof change.value !== 'string') throw new Error('title value must be a string');
      return client.productUpdate({ id, title: change.value });
    case 'description':
      if (typeof change.value !== 'string') throw new Error('description value must be a string');
      return client.productUpdate({ id, descriptionHtml: change.value });
    case 'tags':
      if (!isStringArray(change.value)) throw new Error('tags value must be a string[]');
      return client.productUpdate({ id, tags: change.value });
    case 'images':
      return client.productCreateMedia(id, imageInputs(change.value));
  }
}

export async function applyShopifyChanges(
  projectId: string,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<ApplyProjectResult> {
  const result = await withDecryptedToken(projectId, async (secrets) => {
    const client = makeClient({
      shopDomain: secrets.shopDomain,
      accessToken: secrets.accessToken,
      apiVersion: secrets.apiVersion
    });
    return applyPendingChanges(
      projectId,
      {
        async readProduct(change) {
          const product = await client.productById(change.productSourceId);
          return product
            ? mapAdminProduct(product, { shopDomain: secrets.shopDomain, currency: null })
            : null;
        },
        writeChange: (change) => writeChange(client, change),
        isAuthError: (e) => e instanceof ShopifyAdminError && e.code === 'token_invalid'
      },
      {
        limit: APPLY_BATCH,
        onAuthError: async (m) => {
          if (await markTokenInvalid(projectId, m)) await alertTokenInvalid(projectId);
        }
      }
    );
  });
  return result ?? { projectId, outcomes: [] };
}

/** Every worker tick: cheap when no connected project has pending changes. */
export async function runShopifyApplies(): Promise<ApplyProjectResult[]> {
  const targets = await listForApply('shopify');
  const results: ApplyProjectResult[] = [];
  for (const c of targets) {
    try {
      results.push(await applyShopifyChanges(c.projectId));
    } catch (e) {
      console.error('[shopify] apply failed', c.projectId, e);
    }
  }
  return results;
}
