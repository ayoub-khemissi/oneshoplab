/**
 * Full catalog pull: Admin GraphQL cursor pages → NormalizedProduct →
 * `syncProjectProducts` full mode (archives what Shopify no longer lists),
 * under the same advisory lock as the v1 plugin sync.
 */
import { eq } from 'drizzle-orm';
import { maxProductsForPlan } from '@/entities/ai-model';
import { ProjectSyncLocked, syncProjectProducts, withProjectSyncLock } from '@/entities/product';
import {
  listDueNightlyPulls,
  listRequestedPulls,
  markTokenInvalid,
  setPullProgress,
  withDecryptedToken,
  type DecryptedSecrets
} from '@/entities/shop-connection';
import type { NormalizedProduct } from '@/entities/store-adapter';
import { db } from '@/shared/db';
import { projects, users } from '@/shared/db/schema';
import { mapAdminProduct } from '../lib/map-product';
import { createAdminClient, ShopifyAdminError, type ShopifyAdminClient } from './admin-client';
import { alertSyncFailed, alertTokenInvalid, syncFailureReason } from './alerts';

export type PullResult =
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
  client: ShopifyAdminClient,
  secrets: DecryptedSecrets,
  max: number,
  onPage: (fetched: number) => Promise<void>
): Promise<{ products: NormalizedProduct[]; truncated: boolean }> {
  const shop = await client.shopInfo();
  const ctx = { shopDomain: secrets.shopDomain, currency: shop.currencyCode };
  const products: NormalizedProduct[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await client.productsPage(cursor);
    for (const p of page.products) {
      if (products.length >= max) return { products, truncated: true };
      products.push(mapAdminProduct(p, ctx));
    }
    await onPage(products.length);
    if (!page.hasNextPage || !page.endCursor) return { products, truncated: false };
    cursor = page.endCursor;
  }
}

export async function pullShopifyCatalog(
  projectId: string,
  makeClient: typeof createAdminClient = createAdminClient
): Promise<PullResult> {
  const startedAt = new Date().toISOString();
  const progress = (fetched: number) =>
    setPullProgress(projectId, { phase: 'running', fetched, startedAt }, { clearRequest: true });

  const outcome = await withDecryptedToken(projectId, async (secrets): Promise<PullResult> => {
    await progress(0);
    const client = makeClient({
      shopDomain: secrets.shopDomain,
      accessToken: secrets.accessToken,
      apiVersion: secrets.apiVersion
    });
    try {
      const max = await planLimit(projectId);
      const { products, truncated } = await fetchAll(client, secrets, max, progress);
      const counts = await withProjectSyncLock(projectId, async () => {
        await db.update(projects).set({ source: 'shopify' }).where(eq(projects.id, projectId));
        return syncProjectProducts(projectId, 'shopify', products, { archiveMissing: true });
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
      return { ok: true, fetched: products.length, truncated, ...counts };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof ShopifyAdminError && e.code === 'token_invalid') {
        if (await markTokenInvalid(projectId, message)) await alertTokenInvalid(projectId);
        await setPullProgress(projectId, {
          phase: 'failed',
          fetched: 0,
          startedAt,
          error: message
        });
        return { ok: false, reason: 'token_invalid', error: message };
      }
      if (e instanceof ProjectSyncLocked) {
        await setPullProgress(projectId, null);
        return { ok: false, reason: 'locked' };
      }
      await setPullProgress(projectId, { phase: 'failed', fetched: 0, startedAt, error: message });
      await alertSyncFailed(projectId, { reason: syncFailureReason(e), error: message });
      return { ok: false, reason: 'error', error: message };
    }
  });
  return outcome ?? { ok: false, reason: 'no_connection' };
}

/** Every tick: pulls explicitly requested by the connect flow / "Synchroniser". */
export async function runShopifyRequestedPulls(): Promise<number> {
  const due = await listRequestedPulls();
  for (const c of due) {
    const res = await pullShopifyCatalog(c.projectId);
    if (!res.ok)
      console.warn('[shopify] requested pull failed', c.projectId, res.reason, res.error);
  }
  return due.length;
}

/** Hourly branch: one full pull per connection per 24 h. */
export async function runShopifyNightlyPulls(): Promise<number> {
  const due = await listDueNightlyPulls();
  for (const c of due) {
    const res = await pullShopifyCatalog(c.projectId);
    if (!res.ok) console.warn('[shopify] nightly pull failed', c.projectId, res.reason, res.error);
  }
  return due.length;
}
