/**
 * Worker step: pending `product_changes` of connected projects are written
 * to Shopify. Re-reads the product first: a `priorValueHash` mismatch means
 * the merchant edited the field in Shopify since approval → `conflict`
 * (never overwritten). Acks go through `ackChange` with the same semantics
 * as a plugin, so the product page shows "Appliqué ✓" either way.
 */
import {
  ackChange,
  hashValue,
  listPendingChanges,
  transitionChange,
  type ProductChangeRow
} from '@/entities/product-change';
import { listForApply, markTokenInvalid, withDecryptedToken } from '@/entities/shop-connection';
import type { NormalizedProduct } from '@/entities/store-adapter';
import { db } from '@/shared/db';
import { mapAdminProduct } from '../lib/map-product';
import {
  createAdminClient,
  ShopifyAdminError,
  type CreateMediaInput,
  type ShopifyAdminClient
} from './admin-client';

/** Changes handled per project per tick — bounds tick latency. */
export const APPLY_BATCH = 25;

export type ApplyOutcome = 'applied' | 'conflict' | 'failed' | 'expired' | 'token_invalid';

export interface ApplyProjectResult {
  projectId: string;
  outcomes: Array<{ changeId: string; outcome: ApplyOutcome; error?: string }>;
}

/** Same shape as `currentFieldValue` in entities/product-change — the hash contract. */
function storeFieldValue(p: NormalizedProduct, field: ProductChangeRow['field']): unknown {
  switch (field) {
    case 'title':
      return p.title;
    case 'description':
      return p.descriptionHtml ?? '';
    case 'tags':
      return p.tags ?? [];
    case 'images':
      return p.images.map((i) => ({ src: i.src, alt: i.alt ?? null }));
  }
}

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

async function applyOne(
  client: ShopifyAdminClient,
  shopDomain: string,
  change: ProductChangeRow,
  now: Date
): Promise<{ outcome: ApplyOutcome; error?: string }> {
  if (change.expiresAt && change.expiresAt.getTime() <= now.getTime()) {
    await transitionChange(db, change.id, 'expired', {}, { tolerate: true });
    return { outcome: 'expired' };
  }
  const product = await client.productById(change.productSourceId);
  if (!product) {
    await ackChange(change.projectId, change.id, { status: 'failed', error: 'product_not_found' });
    return { outcome: 'failed', error: 'product_not_found' };
  }
  const current = mapAdminProduct(product, { shopDomain, currency: null });
  const storeValueHash = hashValue(storeFieldValue(current, change.field));
  if (change.priorValueHash && storeValueHash !== change.priorValueHash) {
    // ackChange turns applied + mismatching hash into `conflict`; nothing was written.
    await ackChange(change.projectId, change.id, { status: 'applied', storeValueHash });
    return { outcome: 'conflict' };
  }
  try {
    await writeChange(client, change);
  } catch (e) {
    if (e instanceof ShopifyAdminError && e.code === 'token_invalid') throw e;
    const error = e instanceof Error ? e.message : String(e);
    await ackChange(change.projectId, change.id, { status: 'failed', error });
    return { outcome: 'failed', error };
  }
  await ackChange(change.projectId, change.id, {
    status: 'applied',
    storeValueHash,
    storeUpdatedAt: now.toISOString()
  });
  return { outcome: 'applied' };
}

export async function applyShopifyChanges(
  projectId: string,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<ApplyProjectResult> {
  const result: ApplyProjectResult = { projectId, outcomes: [] };
  await withDecryptedToken(projectId, async (secrets) => {
    const client = makeClient({
      shopDomain: secrets.shopDomain,
      accessToken: secrets.accessToken,
      apiVersion: secrets.apiVersion
    });
    const { changes } = await listPendingChanges(projectId, { limit: APPLY_BATCH });
    const now = new Date();
    for (const change of changes) {
      try {
        const r = await applyOne(client, secrets.shopDomain, change, now);
        result.outcomes.push({ changeId: change.id, ...r });
      } catch (e) {
        if (e instanceof ShopifyAdminError && e.code === 'token_invalid') {
          await markTokenInvalid(projectId, e.message);
          result.outcomes.push({ changeId: change.id, outcome: 'token_invalid', error: e.message });
          return; // the change stays pending until a new token is saved
        }
        const error = e instanceof Error ? e.message : String(e);
        await ackChange(projectId, change.id, { status: 'failed', error });
        result.outcomes.push({ changeId: change.id, outcome: 'failed', error });
      }
    }
  });
  return result;
}

/** Every worker tick: cheap when no connected project has pending changes. */
export async function runShopifyApplies(): Promise<ApplyProjectResult[]> {
  const targets = await listForApply();
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
