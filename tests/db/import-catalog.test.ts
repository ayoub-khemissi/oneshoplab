/**
 * CSV import into a "my own store" catalogue: dry run, write, re-import,
 * plan ceiling, and the route guards in front of it.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null)
}));

import { POST as COMMIT } from '@/app/api/projects/[siteId]/import/commit/route';
import { POST as PREVIEW } from '@/app/api/projects/[siteId]/import/preview/route';
import { commitImport, previewImport, type EnqueueMirrors } from '@/features/import-catalog';
import { resetRateLimits } from '@/shared/api';
import { db } from '@/shared/db';
import { products, projects } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;

const HEADER = 'title,sku,price,tags,description,image_urls';
const IMG = 'https://cdn.example.com/a.jpg';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');
const MAPPING = {
  '0': 'title',
  '1': 'sku',
  '2': 'price',
  '3': 'tags',
  '4': 'description',
  '5': 'imageUrls'
} as const;

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ siteId: id }) });

beforeEach(async () => {
  await resetTables();
  resetRateLimits();
  userId = await createUser();
  projectId = await createProject(userId);
  await db.update(projects).set({ source: 'manual' }).where(eq(projects.id, projectId));
  session.userId = userId;
});
afterAll(resetTables);

describe('previewImport', () => {
  it('forecasts creates, updates, skips and rejects without writing', async () => {
    await db.insert(products).values({
      id: randomUUID(),
      projectId,
      source: 'manual',
      sourceId: 'x',
      handle: 'chemise',
      title: 'Chemise',
      sku: 'CH-1',
      images: [],
      tags: [],
      variants: []
    });
    const preview = await previewImport(projectId, {
      csv: csv(
        `Robe longue,RB-1,24.90,"été | coton",<p>Coton</p>,${IMG}`,
        `Chemise,CH-1,12,,,${IMG}`,
        `Robe longue,RB-1,24.90,,,${IMG}`,
        `,NO-1,5,,,${IMG}`,
        'Sans image,SI-1,5,,,'
      ),
      mapping: MAPPING
    });
    expect(preview.blocked).toBe(false);
    expect(preview.counts).toEqual({ create: 1, update: 1, skip: 1, reject: 2 });
    expect(preview.rows.map((r) => r.action)).toEqual([
      'create',
      'update',
      'skip',
      'reject',
      'reject'
    ]);
    expect(preview.rows[4].reason).toBe('no_image');
    const [{ n }] = await db
      .select({ n: products.id })
      .from(products)
      .where(eq(products.projectId, projectId))
      .then((r) => [{ n: r.length }]);
    expect(n).toBe(1);
  });

  it('flags a file with nothing to import', async () => {
    const preview = await previewImport(projectId, { csv: HEADER, mapping: MAPPING });
    expect(preview.blocked).toBe(true);
    expect(preview.issues.map((i) => i.code)).toContain('header_only');
  });
});

describe('commitImport', () => {
  it('creates, then updates on re-import instead of duplicating', async () => {
    const req = {
      csv: csv(
        `Robe longue,RB-1,"24,90","été | coton",<p>Coton</p>,${IMG}`,
        `Chemise,CH-1,12,,Texte simple,${IMG}`
      ),
      mapping: MAPPING
    };
    const first = await commitImport(projectId, req);
    expect(first.ok).toBe(true);
    expect(first.counts).toMatchObject({ create: 2, update: 0 });

    let rows = await db.select().from(products).where(eq(products.projectId, projectId));
    expect(rows).toHaveLength(2);
    const robe = rows.find((r) => r.sku === 'RB-1')!;
    expect(robe.source).toBe('manual');
    expect(robe.sourceId).toBe(robe.id);
    expect(robe.handle).toBe('robe-longue');
    expect(robe.priceMin).toBe('24.90');
    expect(robe.tags).toEqual(['été', 'coton']);
    expect(robe.descriptionHtml).toBe('<p>Coton</p>');
    // Plain text becomes a paragraph.
    expect(rows.find((r) => r.sku === 'CH-1')!.descriptionHtml).toBe('<p>Texte simple</p>');

    const second = await commitImport(projectId, {
      ...req,
      csv: csv(`Robe longue édition,RB-1,29.90,,,${IMG}`)
    });
    expect(second.counts).toMatchObject({ create: 0, update: 1 });
    rows = await db.select().from(products).where(eq(products.projectId, projectId));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.sku === 'RB-1')!.title).toBe('Robe longue édition');
  });

  it('strips what could run from an imported description', async () => {
    await commitImport(projectId, {
      csv: csv(`Piège,PG-1,1,,"<p onclick=""x()"">Hi<script>alert(1)</script></p>",${IMG}`),
      mapping: MAPPING
    });
    const [row] = await db.select().from(products).where(eq(products.projectId, projectId));
    expect(row.descriptionHtml).toBe('<p>Hi</p>');
  });

  it('hands external image links to the mirroring queue, once per product', async () => {
    const enqueue = vi.fn<EnqueueMirrors>(async () => 1);
    const res = await commitImport(
      projectId,
      {
        csv: csv(`A,A-1,1,,,${IMG} | https://cdn.example.com/b.jpg`),
        mapping: MAPPING
      },
      { enqueue }
    );
    expect(res.imagesQueued).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][2]).toEqual([IMG, 'https://cdn.example.com/b.jpg']);
  });

  it('stops creating at the plan ceiling and reports the excess', async () => {
    // Free plan: 200 products. Fill 199 so exactly one more fits.
    await db.insert(products).values(
      Array.from({ length: 199 }, (_, i) => ({
        id: randomUUID(),
        projectId,
        source: 'manual' as const,
        sourceId: `f${i}`,
        handle: `f-${i}`,
        title: `Filler ${i}`,
        images: [],
        tags: [],
        variants: []
      }))
    );
    const res = await commitImport(projectId, {
      csv: csv(`Un,U-1,1,,,${IMG}`, `Deux,D-1,1,,,${IMG}`),
      mapping: MAPPING
    });
    expect(res.counts).toMatchObject({ create: 1, skip: 1 });
    expect(res.overLimit).toBe(1);
    expect(res.rows.find((r) => r.action === 'skip')?.reason).toBe('plan_limit');
  });
});

describe('routes', () => {
  const body = { csv: csv(`Robe,RB-1,10,,,${IMG}`), mapping: MAPPING };

  it('previews and commits for the owner of a manual store', async () => {
    const p = await PREVIEW(post('/x', body), ctx(projectId));
    expect(p.status).toBe(200);
    expect((await p.json()).counts.create).toBe(1);
    const c = await COMMIT(post('/x', body), ctx(projectId));
    expect(c.status).toBe(200);
    expect((await c.json()).ok).toBe(true);
  });

  it('answers 404 for a connected store, a foreign store, and 401 anonymous', async () => {
    await db.update(projects).set({ source: 'shopify' }).where(eq(projects.id, projectId));
    expect((await PREVIEW(post('/x', body), ctx(projectId))).status).toBe(404);
    const stranger = await createProject(await createUser());
    await db.update(projects).set({ source: 'manual' }).where(eq(projects.id, stranger));
    expect((await COMMIT(post('/x', body), ctx(stranger))).status).toBe(404);
    session.userId = null;
    expect((await PREVIEW(post('/x', body), ctx(projectId))).status).toBe(401);
  });

  it('refuses an oversized body and a runaway caller', async () => {
    const big = await PREVIEW(
      post('/x', body, { 'content-length': String(50 * 1024 * 1024) }),
      ctx(projectId)
    );
    expect(big.status).toBe(413);
    resetRateLimits();
    let last = 200;
    for (let i = 0; i < 7 && last === 200; i++)
      last = (await PREVIEW(post('/x', body), ctx(projectId))).status;
    expect(last).toBe(429);
  });
});
