/**
 * The audit pipeline end to end against a simulated Shopify store:
 * launch → detect → fetch → score → persist → sync products → notify.
 * Network is stubbed per URL. The audit is purely static: it must never
 * queue a generation job nor move the ledger, and that is asserted here.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/entities/user/api/next-auth', () => ({ auth: async () => null }));

import { randomUUID } from 'node:crypto';
import { launchAnonymousAudit, launchAuditForUser, normalizeUrl } from '@/features/run-audit';
import { processAudit } from '@/features/run-audit';
import { db } from '@/shared/db';
import {
  apiKeys,
  audits,
  notifications,
  creditTransactions,
  outboundWebhooks,
  products,
  projects,
  shopConnections,
  webhookDeliveries,
  type Platform
} from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';

type Store = { products: ReturnType<typeof shopifyProduct>[]; up: boolean };
const store: Store = { products: [], up: true };
const shopifyProduct = (id: number, title = `Product ${id}`) => ({
  id,
  title,
  handle: `product-${id}`,
  body_html:
    '<p>' +
    'Great product description with enough words to score well. '.repeat(12) +
    '</p><ul><li>a</li></ul>',
  vendor: 'Brand',
  product_type: 'Type',
  tags: 'one, two, three, four, five',
  updated_at: `2026-0${(id % 8) + 1}-01T00:00:00Z`,
  options: [],
  variants: [{ id: id * 10, title: 'Default', sku: `S${id}`, price: '10.00', available: true }],
  images: Array.from({ length: 4 }, (_, i) => ({
    src: `https://cdn.shopify.com/${id}-${i}.jpg`,
    alt: 'alt',
    width: 1200,
    height: 1200,
    position: i
  }))
});

/** An audit reads and scores; it never generates. Anything else is a
 *  regression that would silently bill merchants for a free feature. */
async function expectNoGeneration() {
  const queued = await db.query.jobs.findMany();
  // `audit_run` is the audit itself; anything else queued here would be a
  // generation the merchant never asked for.
  expect(queued.filter((j) => j.kind !== 'audit_run')).toHaveLength(0);
  const ledger = await db.select().from(creditTransactions);
  expect(ledger.filter((t) => t.delta < 0)).toHaveLength(0);
}

beforeEach(async () => {
  await resetTables();
  store.up = true;
  store.products = [shopifyProduct(1), shopifyProduct(2), shopifyProduct(3), shopifyProduct(4)];
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!store.up) return new Response('down', { status: 503 });
    if (url === 'https://demo.example.com' || url === 'https://demo.example.com/')
      return new Response('<html><script src="https://cdn.shopify.com/t.js"></script></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    if (url.includes('/cart.js')) return Response.json({ currency: 'EUR' });
    if (url.includes('/products.json')) {
      const page = Number(/page=(\d+)/.exec(url)?.[1] ?? 1);
      return Response.json({ products: page === 1 ? store.products : [] });
    }
    return new Response('nope', { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await db.$client.end();
});

async function waitForAudit(id: string) {
  for (let i = 0; i < 100; i++) {
    const a = await db.query.audits.findFirst({ where: eq(audits.id, id) });
    if (a && (a.status === 'completed' || a.status === 'failed')) return a;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('audit did not finish');
}
/** The audit for `projectId` not listed in `known` (createdAt has 1 s resolution). */
async function latestAuditFor(projectId: string, known: string[] = []) {
  const rows = (await db.query.audits.findMany({ where: eq(audits.projectId, projectId) })).filter(
    (r) => !known.includes(r.id)
  );
  expect(rows).toHaveLength(1);
  return waitForAudit(rows[0].id);
}

describe('normalizeUrl', () => {
  it('reduces any store URL to its origin + domain, rejects junk', () => {
    expect(normalizeUrl('https://Demo.example.com/collections/all?x=1')).toEqual({
      url: 'https://demo.example.com',
      domain: 'demo.example.com'
    });
    expect(normalizeUrl('demo.example.com')).toMatchObject({ domain: 'demo.example.com' });
    // The shape a Shopify merchant actually types. Every URL field must accept
    // it bare: the add-site form used input type="url", whose native
    // validation demands a scheme, so this was rejected before it ever reached
    // here — while the field's own placeholder showed a bare domain.
    expect(normalizeUrl('oneshoplab-test.myshopify.com')).toEqual({
      url: 'https://oneshoplab-test.myshopify.com',
      domain: 'oneshoplab-test.myshopify.com'
    });
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('launchAuditForUser + processAudit', () => {
  it('creates the project once per domain, audits, syncs products, notifies, runs the AI sub-audit', async () => {
    const userId = await createUser();
    const norm = normalizeUrl('https://demo.example.com/products/x')!;
    const { projectId } = await launchAuditForUser(userId, norm);
    expect(projectId).toBeTruthy();
    const audit = await latestAuditFor(projectId!);

    expect(audit.status).toBe('completed');
    expect(audit.platform).toBe('shopify');
    expect(audit.productsSampled).toBe(4);
    expect(audit.error).toBeNull();
    const scores = audit.scores as { overall: number };
    expect(scores.overall).toBeGreaterThan(80);
    const summary = audit.summary as {
      allProducts: unknown[];
      detectedLanguage: string | null;
      latestProducts: { handle: string }[];
    };
    expect(summary.allProducts).toHaveLength(4);
    expect(summary.latestProducts).toHaveLength(3);

    const project = (await db.query.projects.findFirst({ where: eq(projects.id, projectId!) }))!;
    expect(project.source).toBe('shopify');
    expect(project.url).toBe('https://demo.example.com');

    const synced = await db.query.products.findMany({ where: eq(products.projectId, projectId!) });
    expect(synced.map((p) => p.sourceId).sort()).toEqual(['1', '2', '3', '4']);
    expect(synced.every((p) => p.status === 'active')).toBe(true);

    await expectNoGeneration();
    const notes = await db.query.notifications.findMany({
      where: eq(notifications.userId, userId)
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'audit_completed', auditId: audit.id, projectId });
    expect((notes[0].payload as { score: number }).score).toBe(scores.overall);

    // Same domain again → same project, a second audit, and the catalog drift is synced.
    store.products = [shopifyProduct(1, 'Renamed'), shopifyProduct(2), shopifyProduct(5)];
    const again = await launchAuditForUser(userId, norm);
    expect(again.projectId).toBe(projectId);
    await latestAuditFor(projectId!, [audit.id]);
    expect(await db.query.projects.findMany({ where: eq(projects.userId, userId) })).toHaveLength(
      1
    );
    const after = await db.query.products.findMany({ where: eq(products.projectId, projectId!) });
    const byId = Object.fromEntries(after.map((p) => [p.sourceId, p]));
    expect(byId['1']).toMatchObject({ title: 'Renamed', status: 'active' });
    expect(byId['3']).toMatchObject({ status: 'archived' });
    expect(byId['3'].archivedAt).toBeInstanceOf(Date);
    expect(byId['4'].status).toBe('archived');
    expect(byId['5']).toMatchObject({ status: 'active' });
  });

  it('marks the audit failed (with the reason) when the store is unreachable, no AI call', async () => {
    store.up = false;
    const userId = await createUser();
    const { projectId } = await launchAuditForUser(
      userId,
      normalizeUrl('https://demo.example.com')!
    );
    const audit = await latestAuditFor(projectId!);
    expect(audit.status).toBe('failed');
    expect(audit.platform).toBe('unknown');
    // A code the UI translates, never prose: it used to be stored in English
    // and rendered verbatim inside a French sentence.
    expect(audit.error).toBe('platform_not_detected');
    await expectNoGeneration();
    const [note] = await db.query.notifications.findMany({
      where: eq(notifications.userId, userId)
    });
    // Not "your audit failed": the storefront could not be read, and the
    // connection is the answer. The notice invites them to plug the store in.
    expect(note.kind).toBe('store_connection_needed');
  });

  it('processAudit is idempotent: a non-pending audit is left alone', async () => {
    const userId = await createUser();
    const { projectId } = await launchAuditForUser(
      userId,
      normalizeUrl('https://demo.example.com')!
    );
    const audit = await latestAuditFor(projectId!);
    await processAudit(audit.id);
    await expectNoGeneration();
    expect(
      (await db.query.audits.findFirst({ where: eq(audits.id, audit.id) }))!.completedAt?.getTime()
    ).toBe(audit.completedAt?.getTime());
  });
});

// ---------------------------------------------------------------------------
// Connected stores: the catalog belongs to the integration, the audit reads it.
// ---------------------------------------------------------------------------

/** Short enough that a store which never answers doesn't slow the suite. */
const WAIT = { catalogWait: { timeoutMs: 300, pollMs: 50 } };
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

async function seedProject(userId: string, source: Platform = 'shopify'): Promise<string> {
  const id = randomUUID();
  await db.insert(projects).values({
    id,
    userId,
    name: 'demo.example.com',
    domain: 'demo.example.com',
    url: 'https://demo.example.com',
    source
  });
  return id;
}

/** Two products as only a connected store can provide them: with a
 *  `sourceImageId` on every image. A scrape can never produce one. */
async function seedStoredCatalog(
  projectId: string,
  source: Platform,
  syncedAt: Date
): Promise<void> {
  await db.insert(products).values(
    [900, 901].map((n) => ({
      id: randomUUID(),
      projectId,
      source,
      sourceId: String(n),
      handle: `stored-${n}`,
      title: `Stored product ${n}`,
      descriptionHtml:
        '<p>' + 'Stored description with plenty of words. '.repeat(10) + '</p><ul><li>a</li></ul>',
      images: [
        {
          src: `https://cdn.example/${n}.jpg`,
          alt: 'alt',
          width: 1400,
          height: 1400,
          position: 0,
          sourceImageId: `img-${n}`
        }
      ],
      tags: ['one', 'two', 'three'],
      variants: [
        { id: `v-${n}`, title: 'Default', price: 10, sku: `S${n}`, available: true, options: {} }
      ],
      vendor: 'Brand',
      productType: 'Type',
      lastSeenAt: syncedAt,
      sourceUpdatedAt: syncedAt
    }))
  );
}

async function connectStore(
  projectId: string,
  platform: 'shopify' | 'wix',
  lastPullAt: Date | null
): Promise<void> {
  await db.insert(shopConnections).values({
    id: randomUUID(),
    projectId,
    platform,
    shopDomain: platform === 'shopify' ? 'demo.myshopify.com' : 'demo.wixsite.com',
    accessTokenCiphertext: 'v1:aa:bb:cc',
    keyId: 'v1',
    scopes: [],
    apiVersion: '2025-07',
    status: 'connected',
    lastPullAt
  });
}

async function startAudit(projectId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(audits).values({
    id,
    url: 'https://demo.example.com',
    domain: 'demo.example.com',
    projectId,
    status: 'pending'
  });
  return id;
}

async function auditRow(id: string) {
  const row = await db.query.audits.findFirst({ where: eq(audits.id, id) });
  if (!row) throw new Error('audit vanished');
  return row;
}

type SourceSummary = {
  source?: string;
  sourceReason?: string;
  catalogStale?: boolean;
  catalogSyncedAt?: string | null;
  allProducts: { sourceId: string | null }[];
};

describe('processAudit on a connected store', () => {
  it('scores the stored catalog and never writes the scrape over it', async () => {
    const userId = await createUser();
    const projectId = await seedProject(userId);
    const syncedAt = new Date(Date.now() - 5 * MINUTE);
    await seedStoredCatalog(projectId, 'shopify', syncedAt);
    await connectStore(projectId, 'shopify', syncedAt);

    const auditId = await startAudit(projectId);
    await processAudit(auditId, WAIT);

    const audit = await auditRow(auditId);
    expect(audit.status).toBe('completed');
    expect(audit.platform).toBe('shopify');
    // The fake storefront serves 4 products; the stored catalog has 2.
    expect(audit.productsSampled).toBe(2);
    const summary = audit.summary as SourceSummary;
    expect(summary.source).toBe('connection');
    expect(summary.sourceReason).toBe('connected');
    expect(summary.catalogStale).toBe(false);
    expect(summary.allProducts.map((p) => p.sourceId).sort()).toEqual(['900', '901']);

    // The catalog is untouched — same rows, and `sourceImageId` survived.
    const rows = await db.query.products.findMany({ where: eq(products.projectId, projectId) });
    expect(rows.map((r) => r.sourceId).sort()).toEqual(['900', '901']);
    expect(rows.map((r) => r.images?.[0]?.sourceImageId).sort()).toEqual(['img-900', 'img-901']);
    expect(rows.every((r) => r.status === 'active')).toBe(true);

    // Fresh catalog: no need to bother the store.
    const [conn] = await db
      .select()
      .from(shopConnections)
      .where(eq(shopConnections.projectId, projectId));
    expect(conn.pullRequestedAt).toBeNull();
    await expectNoGeneration();
  });

  it('records the platform from the connection, not from URL detection', async () => {
    const userId = await createUser();
    const projectId = await seedProject(userId, 'wix');
    const syncedAt = new Date(Date.now() - 5 * MINUTE);
    await seedStoredCatalog(projectId, 'wix', syncedAt);
    await connectStore(projectId, 'wix', syncedAt);

    const auditId = await startAudit(projectId);
    await processAudit(auditId, WAIT);

    // Detection on this URL says "shopify" (the stubbed storefront) — the
    // live connection wins.
    expect((await auditRow(auditId)).platform).toBe('wix');
  });

  it('asks a stale connection for a pull, then scores what is there', async () => {
    const userId = await createUser();
    const projectId = await seedProject(userId);
    const syncedAt = new Date(Date.now() - 8 * DAY);
    await seedStoredCatalog(projectId, 'shopify', syncedAt);
    await connectStore(projectId, 'shopify', syncedAt);

    const auditId = await startAudit(projectId);
    await processAudit(auditId, WAIT);

    const [conn] = await db
      .select()
      .from(shopConnections)
      .where(eq(shopConnections.projectId, projectId));
    expect(conn.pullRequestedAt).toBeInstanceOf(Date);

    const audit = await auditRow(auditId);
    expect(audit.status).toBe('completed');
    expect(audit.productsSampled).toBe(2);
    const summary = audit.summary as SourceSummary;
    expect(summary.source).toBe('connection');
    // Surfaced so the UI can say how old the catalogue is.
    expect(summary.catalogStale).toBe(true);
    // MySQL timestamps have a 1 s resolution.
    expect(
      Math.abs(new Date(summary.catalogSyncedAt!).getTime() - syncedAt.getTime())
    ).toBeLessThan(1000);
    expect(
      (await db.query.products.findMany({ where: eq(products.projectId, projectId) }))
        .map((r) => r.sourceId)
        .sort()
    ).toEqual(['900', '901']);
  });

  it('emits sync.requested for an Integration-API catalog and scores it', async () => {
    const userId = await createUser();
    const projectId = await seedProject(userId, 'woocommerce');
    await seedStoredCatalog(projectId, 'woocommerce', new Date(Date.now() - 2 * DAY));
    await db.insert(apiKeys).values({
      id: randomUUID(),
      projectId,
      userId,
      name: 'plugin',
      prefix: 'osl_live_ab1',
      keyHash: 'a'.repeat(64),
      permissions: ['catalog:write'],
      lastUsedAt: new Date(Date.now() - MINUTE)
    });
    await db.insert(outboundWebhooks).values({
      id: randomUUID(),
      projectId,
      kind: 'self',
      url: 'https://plugin.example/wp-json/oneshoplab/v1/webhook',
      urlHash: 'b'.repeat(64),
      secretCiphertext: 'v1:aa:bb:cc',
      events: ['sync.requested']
    });

    const auditId = await startAudit(projectId);
    await processAudit(auditId, WAIT);

    const deliveries = await db.select().from(webhookDeliveries);
    expect(deliveries.map((d) => d.event)).toEqual(['sync.requested']);

    const audit = await auditRow(auditId);
    expect(audit.platform).toBe('woocommerce');
    expect(audit.productsSampled).toBe(2);
    expect((audit.summary as SourceSummary).source).toBe('connection');
  });

  it('falls back to scraping when the connection never synced anything', async () => {
    const userId = await createUser();
    const projectId = await seedProject(userId);
    await connectStore(projectId, 'shopify', null);

    const auditId = await startAudit(projectId);
    await processAudit(auditId, WAIT);

    const audit = await auditRow(auditId);
    expect(audit.status).toBe('completed');
    expect(audit.productsSampled).toBe(4);
    const summary = audit.summary as SourceSummary;
    expect(summary.source).toBe('storefront');
    expect(summary.sourceReason).toBe('empty_catalog');
    // The scrape IS the catalog here — nothing to overwrite.
    const rows = await db.query.products.findMany({ where: eq(products.projectId, projectId) });
    expect(rows.map((r) => r.sourceId).sort()).toEqual(['1', '2', '3', '4']);
    // And the store was asked to fill the table for next time.
    const [conn] = await db
      .select()
      .from(shopConnections)
      .where(eq(shopConnections.projectId, projectId));
    expect(conn.pullRequestedAt).toBeInstanceOf(Date);
  });

  it('scrapes a project whose site key has gone quiet', async () => {
    const userId = await createUser();
    const projectId = await seedProject(userId);
    await seedStoredCatalog(projectId, 'shopify', new Date(Date.now() - 60 * DAY));
    await db.insert(apiKeys).values({
      id: randomUUID(),
      projectId,
      userId,
      name: 'old plugin',
      prefix: 'osl_live_cd2',
      keyHash: 'c'.repeat(64),
      permissions: ['catalog:write'],
      lastUsedAt: new Date(Date.now() - 60 * DAY)
    });

    const auditId = await startAudit(projectId);
    await processAudit(auditId, WAIT);

    const audit = await auditRow(auditId);
    expect((audit.summary as SourceSummary).source).toBe('storefront');
    expect(audit.productsSampled).toBe(4);
    const rows = await db.query.products.findMany({ where: eq(products.projectId, projectId) });
    // Normal scrape behaviour: the stored rows are archived, the scrape wins.
    expect(
      rows
        .filter((r) => r.status === 'active')
        .map((r) => r.sourceId)
        .sort()
    ).toEqual(['1', '2', '3', '4']);
  });
});

describe('launchAnonymousAudit', () => {
  it('scores without AI (zero credits), and reuses a completed audit for 24h', async () => {
    const norm = normalizeUrl('https://demo.example.com')!;
    const { token } = await launchAnonymousAudit(norm);
    const [row] = await db.query.audits.findMany({ where: eq(audits.anonToken, token) });
    const done = await waitForAudit(row.id);
    expect(done.status).toBe('completed');
    expect(done.projectId).toBeNull();
    await expectNoGeneration();
    expect(await db.query.products.findMany()).toHaveLength(0);

    const second = await launchAnonymousAudit(norm);
    expect(second.token).toBe(token);
    expect(await db.query.audits.findMany()).toHaveLength(1);
  });
});
