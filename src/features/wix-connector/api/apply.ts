/** Worker step: pending changes → Wix, through the shared apply loop (entities/product-change). */
import {
  applyPendingChanges,
  type ApplyProjectResult,
  type ProductChangeRow
} from '@/entities/product-change';
import { listForApply } from '@/entities/shop-connection';
import { mapWixProduct, WIX_RIBBON_MAX } from '../lib/map-product';
import { isWixAuthError } from './alerts';
import { createWixClient, type WixClient } from './client';
import { createWixImageOps } from './image-ops';
import { flagTokenInvalid, withWixClient } from './shared';

export const WIX_APPLY_BATCH = 25;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function imageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('images value must be an array');
  return value.map((v) => {
    const src = (v as { src?: unknown })?.src;
    if (typeof src !== 'string') throw new Error('image value without src');
    return src;
  });
}

async function writeChange(client: WixClient, change: ProductChangeRow): Promise<void> {
  const id = change.productSourceId;
  switch (change.field) {
    case 'title':
      if (typeof change.value !== 'string') throw new Error('title value must be a string');
      return client.productUpdate({ id, name: change.value });
    case 'description':
      if (typeof change.value !== 'string') throw new Error('description value must be a string');
      return client.productUpdate({ id, description: change.value });
    case 'tags':
      if (!isStringArray(change.value)) throw new Error('tags value must be a string[]');
      // Wix has no tags: the ribbon carries the first tag (30 chars max in the dashboard).
      return client.productUpdate({ id, ribbon: (change.value[0] ?? '').slice(0, WIX_RIBBON_MAX) });
    case 'images':
      return client.productAddMedia(id, imageUrls(change.value));
  }
}

export async function applyWixChanges(
  projectId: string,
  makeClient: typeof createWixClient = createWixClient
): Promise<ApplyProjectResult> {
  const result = await withWixClient(projectId, makeClient, (client) =>
    applyPendingChanges(
      projectId,
      {
        async readProduct(change) {
          const p = await client.productById(change.productSourceId);
          return p ? mapWixProduct(p, { collections: new Map() }) : null;
        },
        writeChange: (change) => writeChange(client, change),
        isAuthError: isWixAuthError,
        imageOps: createWixImageOps(client)
      },
      { limit: WIX_APPLY_BATCH, onAuthError: (m) => flagTokenInvalid(projectId, m) }
    )
  );
  return result ?? { projectId, outcomes: [] };
}

export async function runWixApplies(): Promise<ApplyProjectResult[]> {
  const results: ApplyProjectResult[] = [];
  for (const c of await listForApply('wix')) {
    try {
      results.push(await applyWixChanges(c.projectId));
    } catch (e) {
      console.error('[wix] apply failed', c.projectId, e);
    }
  }
  return results;
}
