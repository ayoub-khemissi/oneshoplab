/**
 * A merchant whose storefront can't be detected is sent to "connect your
 * store". Connecting used to pull the catalog and stop there, leaving the
 * failed audit as the latest one — so the dashboard kept showing "platform not
 * detected" next to the products that had just arrived.
 */
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditProjectsWithSyncedCatalog } from '@/features/run-audit';
import { connectShopifyStore, pullShopifyCatalog } from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { audits, products } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import {
  API_SECRET,
  TOKEN,
  createFakeClient,
  fakeProduct,
  type FakeAdminClient
} from './shopify-helpers';
import { createProject } from './site-helpers';

const fakeState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/shopify-connector/api/admin-client', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('@/features/shopify-connector/api/admin-client')>();
  return {
    ...mod,
    createAdminClient: (opts: unknown) => {
      const c = fakeState.current as FakeAdminClient;
      c.lastOptions = opts as FakeAdminClient['lastOptions'];
      return c;
    }
  };
});
vi.mock('@/entities/user/api/next-auth', () => ({ auth: async () => null }));

let userId: string;
let projectId: string;

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
  fakeState.current = createFakeClient([fakeProduct('1'), fakeProduct('2', { title: 'Second' })]);
});
afterAll(async () => {
  await db.$client.end();
});

/** An audit row as the failed pre-connection attempt leaves it behind. */
async function insertAudit(
  status: 'failed' | 'completed',
  createdAt: Date,
  error: string | null = 'Could not detect a supported e-commerce platform on this URL.'
) {
  const id = randomUUID();
  await db.insert(audits).values({
    id,
    url: 'https://atelier.example.com',
    domain: 'atelier.example.com',
    projectId,
    status,
    platform: status === 'failed' ? 'unknown' : 'shopify',
    error: status === 'failed' ? error : null,
    createdAt,
    completedAt: createdAt
  });
  return id;
}

async function latestAudit() {
  const [row] = await db
    .select({
      id: audits.id,
      status: audits.status,
      platform: audits.platform,
      productsSampled: audits.productsSampled,
      summary: audits.summary
    })
    .from(audits)
    .where(eq(audits.projectId, projectId))
    .orderBy(desc(audits.createdAt))
    .limit(1);
  return row;
}

/** Connect + pull, the exact path the OAuth install and "Synchroniser" take. */
async function connectAndPull() {
  const res = await connectShopifyStore({
    projectId,
    userId,
    shopDomain: 'atelier.myshopify.com',
    accessToken: TOKEN,
    apiSecret: API_SECRET
  });
  if (!res.ok) throw new Error(`connect refused: ${res.reason}`);
  const pull = await pullShopifyCatalog(projectId);
  if (!pull.ok) throw new Error(`pull refused: ${pull.reason}`);
}

describe('auditProjectsWithSyncedCatalog', () => {
  it('scores the store whose catalog arrived after the audit failed', async () => {
    await insertAudit('failed', new Date(Date.now() - 60 * 60 * 1000));
    await connectAndPull();
    expect(await db.select().from(products).where(eq(products.projectId, projectId))).toHaveLength(
      2
    );

    expect(await auditProjectsWithSyncedCatalog()).toBe(1);

    const latest = await latestAudit();
    expect(latest.status).toBe('completed');
    expect(latest.platform).toBe('shopify');
    expect(latest.productsSampled).toBe(2);
    // Scored from the stored catalog, so nothing was scraped.
    expect((latest.summary as { source: string }).source).toBe('connection');
  });

  it('settles after one pass — a completed audit is left alone', async () => {
    await insertAudit('failed', new Date(Date.now() - 60 * 60 * 1000));
    await connectAndPull();
    expect(await auditProjectsWithSyncedCatalog()).toBe(1);
    expect(await auditProjectsWithSyncedCatalog()).toBe(0);
    expect(await db.select().from(audits).where(eq(audits.projectId, projectId))).toHaveLength(2);
  });

  it('does not retry a store that failed again after the same catalog', async () => {
    await connectAndPull();
    // A failure dated after the pull: whatever broke, it broke with this
    // catalog in hand, so re-running every tick would only spam the merchant.
    await insertAudit('failed', new Date(Date.now() + 60 * 1000), 'boom');
    expect(await auditProjectsWithSyncedCatalog()).toBe(0);
  });

  it('leaves a store that already has a report alone', async () => {
    await connectAndPull();
    await insertAudit('completed', new Date(Date.now() - 60 * 60 * 1000));
    expect(await auditProjectsWithSyncedCatalog()).toBe(0);
  });

  it('ignores a project with no synced catalog at all', async () => {
    await insertAudit('failed', new Date(Date.now() - 60 * 60 * 1000));
    expect(await auditProjectsWithSyncedCatalog()).toBe(0);
  });
});
