import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { recomputeManualAudit } from '@/entities/audit';
import { ProjectSyncLocked, withProjectSyncLock } from '@/entities/product';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
import type { ImportRowInput } from '../lib/normalize';
import type { ImportRequest } from '../model/request';
import type { PreviewRow } from './preview';
import { blockingIssues, resolvePlan } from './plan';

/** Rows written per INSERT. 200 keeps each statement well under MySQL's packet size. */
const BATCH = 200;

/** Hook for the image mirroring queue; injected so this module has no storage dependency. */
export type EnqueueMirrors = (
  projectId: string,
  productId: string,
  urls: string[]
) => Promise<number>;

export interface ImportResult {
  ok: boolean;
  reason?: 'locked' | 'blocked';
  counts: { create: number; update: number; skip: number; reject: number };
  overLimit: number;
  /** Rows that were not written and why, for the merchant to fix and retry. */
  rows: PreviewRow[];
  /** External image links handed to the mirroring queue. */
  imagesQueued: number;
}

function toRow(input: ImportRowInput, projectId: string, id: string) {
  return {
    id,
    projectId,
    source: 'manual' as const,
    // Manual products mirror their id into sourceId; every key-based lookup
    // (generation jobs, history) relies on it.
    sourceId: id,
    handle: input.handle || id,
    title: input.title,
    descriptionHtml: input.descriptionHtml,
    images: input.images.map((img, position) => ({
      src: img.src,
      alt: img.alt,
      width: null,
      height: null,
      position
    })),
    tags: input.tags,
    variants: [],
    vendor: input.vendor,
    productType: input.productType,
    priceMin: input.priceMin != null ? input.priceMin.toFixed(2) : null,
    priceMax: input.priceMax != null ? input.priceMax.toFixed(2) : null,
    currency: input.currency,
    sku: input.sku,
    status: 'active' as const
  };
}

/**
 * Write the import. The plan is recomputed from the file here — the preview
 * the merchant approved is not an input, it was a forecast of this very
 * computation. Creates go in batches; updates go one by one, since each
 * targets a different row. Everything runs under the project's sync lock,
 * so a second import (or a plugin batch) waits its turn instead of racing.
 */
export async function commitImport(
  projectId: string,
  req: ImportRequest,
  deps: { enqueue?: EnqueueMirrors } = {}
): Promise<ImportResult> {
  const { parsed, plan } = await resolvePlan(projectId, req);
  const notWritten = plan.rows.filter((r) => r.action === 'skip' || r.action === 'reject');
  const asPreview = (rows: typeof plan.rows): PreviewRow[] =>
    rows.map((r) => ({
      row: r.row,
      action: r.action,
      ...(r.reason ? { reason: r.reason } : {}),
      errors: r.errors,
      warnings: r.warnings
    }));

  if (blockingIssues(parsed).length > 0) {
    return {
      ok: false,
      reason: 'blocked',
      counts: plan.counts,
      overLimit: plan.overLimit,
      rows: [],
      imagesQueued: 0
    };
  }

  const mirrors: Array<{ productId: string; urls: string[] }> = [];
  try {
    await withProjectSyncLock(projectId, async () => {
      const creates = plan.rows.filter((r) => r.action === 'create' && r.input);
      for (let i = 0; i < creates.length; i += BATCH) {
        const slice = creates.slice(i, i + BATCH);
        const values = slice.map((r) => {
          const id = randomUUID();
          mirrors.push({ productId: id, urls: r.input!.images.map((img) => img.src) });
          return toRow(r.input!, projectId, id);
        });
        await db.insert(products).values(values);
      }

      for (const r of plan.rows) {
        if (r.action !== 'update' || !r.input || !r.productId) continue;
        const input = r.input;
        const row = toRow(input, projectId, r.productId);
        // An update without images keeps the gallery the product already has.
        const { id: _id, sourceId: _sourceId, images, ...rest } = row;
        await db
          .update(products)
          .set(input.images.length > 0 ? { ...rest, images } : rest)
          .where(eq(products.id, r.productId));
        if (input.images.length > 0)
          mirrors.push({ productId: r.productId, urls: images.map((i) => i.src) });
      }
    });
  } catch (e) {
    if (e instanceof ProjectSyncLocked) {
      return {
        ok: false,
        reason: 'locked',
        counts: plan.counts,
        overLimit: plan.overLimit,
        rows: asPreview(notWritten),
        imagesQueued: 0
      };
    }
    throw e;
  }

  let imagesQueued = 0;
  if (deps.enqueue) {
    for (const m of mirrors) imagesQueued += await deps.enqueue(projectId, m.productId, m.urls);
  }
  // The site's score reads the catalogue: refresh it so the dashboard agrees
  // with what was just imported. Best effort — a failed rescore is not a
  // failed import.
  await recomputeManualAudit(projectId).catch((e: unknown) =>
    console.error('[import] rescore failed', e)
  );

  return {
    ok: true,
    counts: plan.counts,
    overLimit: plan.overLimit,
    rows: asPreview(notWritten),
    imagesQueued
  };
}
