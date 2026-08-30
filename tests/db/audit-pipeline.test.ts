/**
 * The audit pipeline end to end against a simulated Shopify store:
 * launch → detect → fetch → score → persist → sync products → notify.
 * Network is stubbed per URL; the AI dynamic sub-audit is mocked.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runDynamicAuditForProduct = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/run-audit/api/dynamic-audit', () => ({
  runDynamicAuditForProduct: (...a: unknown[]) => runDynamicAuditForProduct(...a)
}));
vi.mock('@/entities/user/api/next-auth', () => ({ auth: async () => null }));

import { launchAnonymousAudit, launchAuditForUser, normalizeUrl } from '@/features/run-audit';
import { processAudit } from '@/features/run-audit';
import { db } from '@/lib/db';
import { audits, notifications, products, projects } from '@/lib/db/schema';
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

beforeEach(async () => {
  await resetTables();
  runDynamicAuditForProduct.mockClear();
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

    expect(runDynamicAuditForProduct).toHaveBeenCalledTimes(3);
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
    expect(audit.error).toMatch(/detect/i);
    expect(runDynamicAuditForProduct).not.toHaveBeenCalled();
    const [note] = await db.query.notifications.findMany({
      where: eq(notifications.userId, userId)
    });
    expect(note.kind).toBe('audit_failed');
  });

  it('processAudit is idempotent: a non-pending audit is left alone', async () => {
    const userId = await createUser();
    const { projectId } = await launchAuditForUser(
      userId,
      normalizeUrl('https://demo.example.com')!
    );
    const audit = await latestAuditFor(projectId!);
    runDynamicAuditForProduct.mockClear();
    await processAudit(audit.id);
    expect(runDynamicAuditForProduct).not.toHaveBeenCalled();
    expect(
      (await db.query.audits.findFirst({ where: eq(audits.id, audit.id) }))!.completedAt?.getTime()
    ).toBe(audit.completedAt?.getTime());
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
    expect(runDynamicAuditForProduct).not.toHaveBeenCalled();
    expect(await db.query.products.findMany()).toHaveLength(0);

    const second = await launchAnonymousAudit(norm);
    expect(second.token).toBe(token);
    expect(await db.query.audits.findMany()).toHaveLength(1);
  });
});
