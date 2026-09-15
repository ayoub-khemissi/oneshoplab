/**
 * Catalogue export: the browsable page (pagination, server sort, filters)
 * and the CSV download route (ownership, rate limit, content).
 */
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null)
}));

import { GET as EXPORT } from '@/app/api/projects/[siteId]/export/route';
import {
  buildCatalogCsv,
  loadExportPage,
  loadExportRow,
  loadExportRows,
  parseExportQuery,
  PAGE_SIZE
} from '@/features/export-catalog';
import { resetRateLimits } from '@/shared/api';
import { db } from '@/shared/db';
import { products } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;

async function addProduct(opts: {
  title: string;
  sku?: string | null;
  vendor?: string | null;
  status?: 'active' | 'archived';
  images?: Array<{ src: string; alt: string | null; width: number | null; height: number | null }>;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(products).values({
    id,
    projectId,
    source: 'shopify',
    sourceId: `src-${id.slice(0, 8)}`,
    title: opts.title,
    sku: opts.sku ?? null,
    vendor: opts.vendor ?? null,
    status: opts.status ?? 'active',
    images: opts.images ?? [],
    tags: [],
    variants: []
  });
  return id;
}

// Route handlers read req.nextUrl, which only exists on a NextRequest.
function request(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`);
}

const ctx = (id: string) => ({ params: Promise.resolve({ siteId: id }) });

beforeEach(async () => {
  await resetTables();
  resetRateLimits();
  userId = await createUser();
  projectId = await createProject(userId);
  session.userId = userId;
});
afterAll(resetTables);

describe('browsable page', () => {
  it('pages at 25 and reports the real total', async () => {
    for (let i = 0; i < 30; i++)
      await addProduct({ title: `Product ${String(i).padStart(2, '0')}` });

    const first = await loadExportPage(projectId, parseExportQuery({}));
    expect(first.total).toBe(30);
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.pageCount).toBe(2);

    const second = await loadExportPage(projectId, parseExportQuery({ page: '2' }));
    expect(second.rows).toHaveLength(5);
    // No overlap between pages: the id tie-break keeps the window stable.
    const ids = new Set([...first.rows, ...second.rows].map((r) => r.id));
    expect(ids.size).toBe(30);

    // A page past the end lands on the last one rather than an empty screen.
    const far = await loadExportPage(projectId, parseExportQuery({ page: '99' }));
    expect(far.page).toBe(2);
    expect(far.rows).toHaveLength(5);
  });

  it('sorts server-side, both directions', async () => {
    await addProduct({ title: 'Banana' });
    await addProduct({ title: 'Apple' });
    await addProduct({ title: 'Cherry' });

    const asc = await loadExportPage(projectId, parseExportQuery({ sort: 'title', dir: 'asc' }));
    expect(asc.rows.map((r) => r.title)).toEqual(['Apple', 'Banana', 'Cherry']);

    const desc = await loadExportPage(projectId, parseExportQuery({ sort: 'title', dir: 'desc' }));
    expect(desc.rows.map((r) => r.title)).toEqual(['Cherry', 'Banana', 'Apple']);
  });

  it('filters on name, sku and brand, and hides archived by default', async () => {
    await addProduct({ title: 'Robe longue', sku: 'RB-1', vendor: 'Atelier' });
    await addProduct({ title: 'Chemise', sku: 'CH-9', vendor: 'Robe & Co' });
    await addProduct({ title: 'Vieux stock', status: 'archived' });

    const byTitle = await loadExportPage(projectId, parseExportQuery({ q: 'robe' }));
    expect(byTitle.total).toBe(2);

    const bySku = await loadExportPage(projectId, parseExportQuery({ q: 'CH-9' }));
    expect(bySku.rows.map((r) => r.title)).toEqual(['Chemise']);

    const active = await loadExportPage(projectId, parseExportQuery({}));
    expect(active.total).toBe(2);
    const archived = await loadExportPage(projectId, parseExportQuery({ status: 'archived' }));
    expect(archived.rows.map((r) => r.title)).toEqual(['Vieux stock']);
    const all = await loadExportPage(projectId, parseExportQuery({ status: 'all' }));
    expect(all.total).toBe(3);
  });

  it('treats LIKE wildcards as characters, not operators', async () => {
    await addProduct({ title: 'Pack 100% coton' });
    await addProduct({ title: 'Chemise' });
    // Unescaped, "%" would match every row.
    const res = await loadExportPage(projectId, parseExportQuery({ q: '100%' }));
    expect(res.rows.map((r) => r.title)).toEqual(['Pack 100% coton']);
  });

  it('never reaches across projects', async () => {
    const otherProject = await createProject(await createUser());
    const mine = await addProduct({ title: 'Mine' });
    expect(await loadExportRow(projectId, mine)).not.toBeNull();
    expect(await loadExportRow(otherProject, mine)).toBeNull();
  });
});

describe('CSV', () => {
  it('writes the chosen columns, with image links', async () => {
    await addProduct({
      title: 'Robe longue',
      sku: 'RB-1',
      images: [{ src: 'https://cdn.example.com/a.jpg', alt: 'devant', width: 800, height: 800 }]
    });
    const query = parseExportQuery({ columns: 'title,sku,imageUrls' });
    const rows = await loadExportRows(projectId, query);
    const csv = buildCatalogCsv(rows, query.columns);
    const [header, line] = csv.replace(/^﻿/, '').split('\r\n');
    expect(header).toBe('title,sku,image_urls');
    expect(line).toBe('Robe longue,RB-1,https://cdn.example.com/a.jpg');
  });

  it('serves a semicolon file when asked, and quotes for that separator', async () => {
    await addProduct({ title: 'Robe, longue; noire', sku: 'RB-1' });
    const query = parseExportQuery({ columns: 'title,sku', sep: 'semicolon' });
    const csv = buildCatalogCsv(await loadExportRows(projectId, query), query.columns, 'semicolon');
    const [header, line] = csv.replace(/^\ufeff/, '').split('\r\n');
    expect(header).toBe('title;sku');
    // The comma rides along untouched; only the semicolon forces quoting.
    expect(line).toBe('"Robe, longue; noire";RB-1');
  });

  it('neutralises a formula hidden in a product name', async () => {
    await addProduct({ title: '=cmd|calc', sku: 'X' });
    const query = parseExportQuery({ columns: 'title,sku' });
    const csv = buildCatalogCsv(await loadExportRows(projectId, query), query.columns);
    // The cell is no longer a formula: it now starts with a quote, and the
    // pipe needs no CSV quoting, so the raw cell is exactly this.
    expect(csv).toContain("\r\n'=cmd|calc,X");
    expect(csv).not.toContain('\r\n=cmd');
  });
});

describe('download route', () => {
  it('serves a CSV attachment to the owner', async () => {
    await addProduct({ title: 'Robe longue', sku: 'RB-1' });
    const res = await EXPORT(request(`/api/projects/${projectId}/export`), ctx(projectId));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('.csv');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(await res.text()).toContain('Robe longue');
  });

  it('serves a .tsv with the tab content type', async () => {
    await addProduct({ title: 'Robe' });
    const res = await EXPORT(request(`/api/projects/${projectId}/export?sep=tab`), ctx(projectId));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('tab-separated-values');
    expect(res.headers.get('Content-Disposition')).toContain('.tsv');
  });

  it('exports a single product on request', async () => {
    const keep = await addProduct({ title: 'Gardé' });
    await addProduct({ title: 'Ignoré' });
    const res = await EXPORT(
      request(`/api/projects/${projectId}/export?productId=${keep}`),
      ctx(projectId)
    );
    const body = await res.text();
    expect(body).toContain('Gardé');
    expect(body).not.toContain('Ignoré');
  });

  it('hides a project it does not own behind a 404, and refuses anonymous callers', async () => {
    const strangerProject = await createProject(await createUser());
    expect((await EXPORT(request('/x'), ctx(strangerProject))).status).toBe(404);

    session.userId = null;
    expect((await EXPORT(request('/x'), ctx(projectId))).status).toBe(401);
  });

  it('stops a download loop with 429 and a Retry-After', async () => {
    await addProduct({ title: 'Robe' });
    let last = await EXPORT(request('/x'), ctx(projectId));
    for (let i = 0; i < 12 && last.status === 200; i++) {
      last = await EXPORT(request('/x'), ctx(projectId));
    }
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
