/** Full catalog pull — mirrors shopify-connector/api/pull.ts on the Wix Stores query API. */
import { eq } from 'drizzle-orm';
import { maxProductsForPlan } from '@/entities/ai-model';
import { emitProjectEvent } from '@/entities/outbound-webhook';
import { ProjectSyncLocked, syncProjectProducts, withProjectSyncLock } from '@/entities/product';
import {
  listDueNightlyPulls,
  listRequestedPulls,
  setPullProgress
} from '@/entities/shop-connection';
import type { NormalizedProduct } from '@/entities/store-adapter';
import { db } from '@/shared/db';
import { projects, users } from '@/shared/db/schema';
import { mapWixProduct, WIX_PRODUCTS_PAGE_SIZE } from '../lib/map-product';
import { alertSyncFailed, syncFailureReason } from './alerts';
import { createWixClient, WixClientError, type WixClient } from './client';
import { flagTokenInvalid, withWixClient } from './shared';

export type WixPullResult =
  | {
      ok: true;
      fetched: number;
      inserted: number;
      updated: number;
      archived: number;
      truncated: boolean;
    }
  | { ok: false; reason: 'no_connection' | 'token_invalid' | 'locked' | 'error'; error?: string };

async function planLimit(projectId: string): Promise<number> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(eq(projects.id, projectId));
  return maxProductsForPlan(row?.plan);
}

async function fetchAll(
  client: WixClient,
  max: number,
  onPage: (fetched: number) => Promise<void>
): Promise<{ products: NormalizedProduct[]; truncated: boolean }> {
  const ctx = { collections: await client.collections() };
  const products: NormalizedProduct[] = [];
  for (let offset = 0; ; offset += WIX_PRODUCTS_PAGE_SIZE) {
    const page = await client.productsPage(offset);
    for (const p of page.products) {
      if (products.length >= max) return { products, truncated: true };
      products.push(mapWixProduct(p, ctx));
    }
    await onPage(products.length);
    if (page.products.length < WIX_PRODUCTS_PAGE_SIZE || products.length >= page.total)
      return { products, truncated: false };
  }
}

export async function pullWixCatalog(
  projectId: string,
  makeClient: typeof createWixClient = createWixClient
): Promise<WixPullResult> {
  const startedAt = new Date().toISOString();
  const progress = (fetched: number) =>
    setPullProgress(projectId, { phase: 'running', fetched, startedAt }, { clearRequest: true });
  const outcome = await withWixClient(
    projectId,
    makeClient,
    async (client): Promise<WixPullResult> => {
      await progress(0);
      try {
        const max = await planLimit(projectId);
        const { products, truncated } = await fetchAll(client, max, progress);
        const counts = await withProjectSyncLock(projectId, async () => {
          await db.update(projects).set({ source: 'wix' }).where(eq(projects.id, projectId));
          return syncProjectProducts(projectId, 'wix', products, { archiveMissing: true });
        });
        const finishedAt = new Date();
        await setPullProgress(
          projectId,
          {
            phase: 'done',
            fetched: products.length,
            startedAt,
            finishedAt: finishedAt.toISOString(),
            ...(truncated ? { error: `plan_limit:${max}` } : {})
          },
          { lastPullAt: finishedAt, clearRequest: true }
        );
        if (truncated) await alertSyncFailed(projectId, { reason: 'plan_limit', limit: max });
        await emitProjectEvent(projectId, 'sync.completed', {
          source: 'wix',
          fetched: products.length,
          truncated,
          ...counts
        });
        return { ok: true, fetched: products.length, truncated, ...counts };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (e instanceof WixClientError && e.code === 'token_invalid') {
          await flagTokenInvalid(projectId, message);
          await setPullProgress(projectId, {
            phase: 'failed',
            fetched: 0,
            startedAt,
            error: message
          });
          await emitProjectEvent(projectId, 'sync.failed', {
            source: 'wix',
            reason: 'token_invalid',
            error: message.slice(0, 500)
          });
          return { ok: false, reason: 'token_invalid', error: message };
        }
        if (e instanceof ProjectSyncLocked) {
          await setPullProgress(projectId, null);
          return { ok: false, reason: 'locked' };
        }
        await setPullProgress(projectId, {
          phase: 'failed',
          fetched: 0,
          startedAt,
          error: message
        });
        await alertSyncFailed(projectId, { reason: syncFailureReason(e), error: message });
        await emitProjectEvent(projectId, 'sync.failed', {
          source: 'wix',
          reason: syncFailureReason(e),
          error: message.slice(0, 500)
        });
        return { ok: false, reason: 'error', error: message };
      }
    }
  );
  return outcome ?? { ok: false, reason: 'no_connection' };
}

export async function runWixRequestedPulls(): Promise<number> {
  const due = await listRequestedPulls('wix');
  for (const c of due) {
    const res = await pullWixCatalog(c.projectId);
    if (!res.ok) console.warn('[wix] requested pull failed', c.projectId, res.reason, res.error);
  }
  return due.length;
}

export async function runWixNightlyPulls(): Promise<number> {
  const due = await listDueNightlyPulls(new Date(), 'wix');
  for (const c of due) {
    const res = await pullWixCatalog(c.projectId);
    if (!res.ok) console.warn('[wix] nightly pull failed', c.projectId, res.reason, res.error);
  }
  return due.length;
}
