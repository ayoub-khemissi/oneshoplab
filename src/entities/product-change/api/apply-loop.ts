/**
 * Driver-agnostic "apply pending changes" loop shared by the store
 * connectors (Shopify, Wix): list pending → expiry → re-read the field →
 * `priorValueHash` check (a mismatch = the merchant edited the store since
 * approval → `conflict`, nothing written) → write → ack. Acks go through
 * `ackChange` with the plugin semantics, so the product page shows the same
 * "Appliqué ✓" whatever the driver.
 */
import type { ProductChangeField } from '@/shared/db/schema';
import { db } from '@/shared/db';
import { hashValue } from '../lib/hash';
import { imageOpsPayloadSchema, type ImageOp } from '../lib/image-ops';
import type { ProductChangeRow } from '../model/types';
import { ackChange, listPendingChanges } from './changes';
import { transitionChange } from './transitions';

export type ApplyOutcome = 'applied' | 'conflict' | 'failed' | 'expired' | 'token_invalid';

export interface ApplyProjectResult {
  projectId: string;
  outcomes: Array<{ changeId: string; outcome: ApplyOutcome; error?: string }>;
}

/** Minimal product shape the hash contract needs (same as `currentFieldValue`). */
export interface ApplyFieldSource {
  title: string;
  descriptionHtml: string | null;
  tags: string[] | null;
  images: Array<{ src: string; alt: string | null; sourceImageId?: string | null }>;
}

/**
 * One provider = one executor (docs/api/IMAGE-OPS.md §7). The WooCommerce
 * plugin implements it in PHP behind `/changes` + ack; the OSL-driven
 * connectors implement it here, in TypeScript, behind this loop.
 */
export interface ImageOpsExecutor {
  /** Store-side gallery with its `sourceImageId`s — for prior_value + conflict. */
  readImages(productSourceId: string): Promise<ApplyFieldSource['images']>;
  /** Never throws on a stale target: it comes back in `skippedOps` (`"<i>:<verb>"`). */
  applyOps(productSourceId: string, ops: ImageOp[]): Promise<{ skippedOps: string[] }>;
}

export interface ApplyDriver {
  /** Current product in the store, null when it no longer exists. */
  readProduct(change: ProductChangeRow): Promise<ApplyFieldSource | null>;
  writeChange(change: ProductChangeRow): Promise<void>;
  /** True for a 401/403-class error: the loop stops and reports `token_invalid`. */
  isAuthError(e: unknown): boolean;
  /** Present = the provider speaks ops; absent = replace-all only (§5). */
  imageOps?: ImageOpsExecutor;
}

/** Same shape as `currentFieldValue` in ./changes — the hash contract. */
export function storeFieldValue(p: ApplyFieldSource, field: ProductChangeField): unknown {
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

async function applyOne(
  driver: ApplyDriver,
  change: ProductChangeRow,
  now: Date
): Promise<{ outcome: ApplyOutcome; error?: string }> {
  if (change.expiresAt && change.expiresAt.getTime() <= now.getTime()) {
    await transitionChange(db, change.id, 'expired', {}, { tolerate: true });
    return { outcome: 'expired' };
  }
  const product = await driver.readProduct(change);
  if (!product) {
    await ackChange(change.projectId, change.id, { status: 'failed', error: 'product_not_found' });
    return { outcome: 'failed', error: 'product_not_found' };
  }
  const storeValueHash = hashValue(storeFieldValue(product, change.field));
  if (change.priorValueHash && storeValueHash !== change.priorValueHash) {
    // ackChange turns applied + mismatching hash into `conflict`; nothing was written.
    await ackChange(change.projectId, change.id, { status: 'applied', storeValueHash });
    return { outcome: 'conflict' };
  }
  let skippedOps: string[] | undefined;
  try {
    const executor = change.field === 'images' ? driver.imageOps : undefined;
    const ops = executor ? opsOf(change) : null;
    if (executor && ops) {
      skippedOps = (await executor.applyOps(change.productSourceId, ops)).skippedOps;
    } else {
      await driver.writeChange(change);
    }
  } catch (e) {
    if (driver.isAuthError(e)) throw e;
    const error = e instanceof Error ? e.message : String(e);
    await ackChange(change.projectId, change.id, { status: 'failed', error });
    return { outcome: 'failed', error };
  }
  await ackChange(change.projectId, change.id, {
    status: 'applied',
    storeValueHash,
    storeUpdatedAt: now.toISOString(),
    ...(skippedOps ? { skippedOps } : {})
  });
  return { outcome: 'applied' };
}

/** Ops payload, or null when the value is the plain replace-all array (§2). */
function opsOf(change: ProductChangeRow): ImageOp[] | null {
  const parsed = imageOpsPayloadSchema.safeParse(change.value);
  return parsed.success ? parsed.data.ops : null;
}

/**
 * Applies up to `limit` pending changes of one project. On an auth error the
 * remaining changes stay pending (the caller flips the connection status);
 * `onAuthError` runs once with that error.
 */
export async function applyPendingChanges(
  projectId: string,
  driver: ApplyDriver,
  opts: { limit: number; onAuthError?: (message: string) => Promise<void> }
): Promise<ApplyProjectResult> {
  const result: ApplyProjectResult = { projectId, outcomes: [] };
  const { changes } = await listPendingChanges(projectId, { limit: opts.limit });
  const now = new Date();
  for (const change of changes) {
    try {
      result.outcomes.push({ changeId: change.id, ...(await applyOne(driver, change, now)) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (driver.isAuthError(e)) {
        await opts.onAuthError?.(error);
        result.outcomes.push({ changeId: change.id, outcome: 'token_invalid', error });
        return result;
      }
      await ackChange(projectId, change.id, { status: 'failed', error });
      result.outcomes.push({ changeId: change.id, outcome: 'failed', error });
    }
  }
  return result;
}
