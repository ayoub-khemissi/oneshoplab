/**
 * Image mirror queue: enqueue dedupes and skips our own URLs; the worker pass
 * rewrites products.images[].src on success, counts attempts on failure and
 * gives up at the third one, and never processes a row twice across two
 * concurrent passes. R2 is mocked — nothing leaves the box.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const OUR_BASE = 'https://cdn.test.local';
const storage = vi.hoisted(() => ({
  uploadBuffer: vi.fn(async (buf: Buffer, key: string, contentType: string) => ({
    key,
    publicUrl: `https://cdn.test.local/${key}`,
    contentType,
    size: buf.length
  }))
}));
vi.mock('@/shared/storage', () => ({
  isR2Configured: () => true,
  isOurStorageUrl: (url: string) => url.startsWith('https://cdn.test.local/'),
  uploadBuffer: storage.uploadBuffer
}));

import { enqueueImageMirrors, mirrorQueuedImages } from '@/entities/product';
import { db } from '@/shared/db';
import { imageMirrorQueue, products } from '@/shared/db/schema';
import { SafeFetchError, type fetchRemoteImage } from '@/shared/lib/safe-fetch';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

type Image = {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  position?: number;
};

let projectId: string;

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const okFetcher: typeof fetchRemoteImage = vi.fn(async () => ({
  buffer: PNG,
  contentType: 'image/png'
}));

async function addProduct(images: Image[]): Promise<string> {
  const id = randomUUID();
  await db.insert(products).values({
    id,
    projectId,
    source: 'manual',
    sourceId: `src-${id.slice(0, 8)}`,
    title: 'Mug',
    status: 'active',
    images,
    tags: [],
    variants: []
  });
  return id;
}

async function productImages(id: string): Promise<Image[]> {
  const row = await db.query.products.findFirst({ where: eq(products.id, id) });
  return (row?.images ?? []) as Image[];
}

async function queueRows(productId: string) {
  return db.select().from(imageMirrorQueue).where(eq(imageMirrorQueue.productId, productId));
}

beforeEach(async () => {
  // resetTables predates this table; its FK cascade does not fire on TRUNCATE.
  await db.delete(imageMirrorQueue);
  await resetTables();
  storage.uploadBuffer.mockClear();
  vi.mocked(okFetcher).mockClear();
  const userId = await createUser();
  projectId = await createProject(userId);
});
afterAll(async () => {
  await db.delete(imageMirrorQueue);
  await resetTables();
});

describe('enqueueImageMirrors', () => {
  it('inserts one pending row per distinct external URL', async () => {
    const productId = await addProduct([]);
    const n = await enqueueImageMirrors(projectId, productId, [
      'https://shop.example/a.jpg',
      'https://shop.example/b.jpg',
      'https://shop.example/a.jpg',
      ' https://shop.example/b.jpg '
    ]);
    expect(n).toBe(2);
    const rows = await queueRows(productId);
    expect(rows.map((r) => r.sourceUrl).sort()).toEqual([
      'https://shop.example/a.jpg',
      'https://shop.example/b.jpg'
    ]);
    expect(rows.every((r) => r.status === 'pending' && r.attempts === 0)).toBe(true);
  });

  it('skips URLs already on our storage, blanks and oversized links', async () => {
    const productId = await addProduct([]);
    const n = await enqueueImageMirrors(projectId, productId, [
      `${OUR_BASE}/products/${projectId}/x.png`,
      '',
      'https://shop.example/' + 'a'.repeat(2100),
      'https://shop.example/keep.jpg'
    ]);
    expect(n).toBe(1);
    const rows = await queueRows(productId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceUrl).toBe('https://shop.example/keep.jpg');
  });

  it('returns 0 and inserts nothing when every URL is ours', async () => {
    const productId = await addProduct([]);
    expect(await enqueueImageMirrors(projectId, productId, [`${OUR_BASE}/p.png`])).toBe(0);
    expect(await queueRows(productId)).toHaveLength(0);
  });
});

describe('mirrorQueuedImages', () => {
  it('rewrites every matching image src and marks the row done', async () => {
    const ext = 'https://shop.example/a.jpg';
    const other = 'https://shop.example/b.jpg';
    const productId = await addProduct([
      { src: ext, alt: 'Front', width: 800, height: 600, position: 1 },
      { src: other, alt: null, width: null, height: null, position: 2 },
      { src: ext, alt: 'Dup', width: 10, height: 10, position: 3 }
    ]);
    await enqueueImageMirrors(projectId, productId, [ext]);

    expect(await mirrorQueuedImages({ fetcher: okFetcher })).toBe(1);

    expect(okFetcher).toHaveBeenCalledWith(ext);
    expect(storage.uploadBuffer).toHaveBeenCalledTimes(1);
    const [buf, key, type] = storage.uploadBuffer.mock.calls[0];
    expect(buf.equals(PNG)).toBe(true);
    expect(key).toMatch(new RegExp(`^products/${projectId}/[0-9a-f-]{36}\\.png$`));
    expect(type).toBe('image/png');

    const images = await productImages(productId);
    const mirrored = `${OUR_BASE}/${key}`;
    expect(images).toEqual([
      { src: mirrored, alt: 'Front', width: 800, height: 600, position: 1 },
      { src: other, alt: null, width: null, height: null, position: 2 },
      { src: mirrored, alt: 'Dup', width: 10, height: 10, position: 3 }
    ]);

    const [row] = await queueRows(productId);
    expect(row.status).toBe('done');
    expect(row.attempts).toBe(1);
    expect(row.error).toBeNull();

    // Nothing left to do.
    expect(await mirrorQueuedImages({ fetcher: okFetcher, retryDelayMs: 0 })).toBe(0);
  });

  it('counts attempts, fails at the third and leaves the external link intact', async () => {
    const ext = 'https://shop.example/broken.jpg';
    const productId = await addProduct([{ src: ext, alt: null, width: null, height: null }]);
    await enqueueImageMirrors(projectId, productId, [ext]);
    const failing = vi.fn(async () => {
      throw new SafeFetchError('http', 'HTTP 404 ' + 'x'.repeat(600));
    }) as unknown as typeof fetchRemoteImage;

    expect(await mirrorQueuedImages({ fetcher: failing, retryDelayMs: 0 })).toBe(1);
    let [row] = await queueRows(productId);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.error).toMatch(/^http: HTTP 404/);
    expect(row.error!.length).toBe(500);

    expect(await mirrorQueuedImages({ fetcher: failing, retryDelayMs: 0 })).toBe(1);
    [row] = await queueRows(productId);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(2);

    expect(await mirrorQueuedImages({ fetcher: failing, retryDelayMs: 0 })).toBe(1);
    [row] = await queueRows(productId);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(3);

    // Given up: no fourth call, product untouched, nothing uploaded.
    expect(await mirrorQueuedImages({ fetcher: failing, retryDelayMs: 0 })).toBe(0);
    expect(failing).toHaveBeenCalledTimes(3);
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
    expect(await productImages(productId)).toEqual([
      { src: ext, alt: null, width: null, height: null }
    ]);
  });

  it('does not retry a freshly claimed row before the retry delay', async () => {
    const ext = 'https://shop.example/slow.jpg';
    const productId = await addProduct([{ src: ext, alt: null, width: null, height: null }]);
    await enqueueImageMirrors(projectId, productId, [ext]);
    const failing = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetchRemoteImage;

    expect(await mirrorQueuedImages({ fetcher: failing })).toBe(1);
    expect(await mirrorQueuedImages({ fetcher: failing })).toBe(0);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('never processes the same row twice across two concurrent passes', async () => {
    const productId = await addProduct([]);
    const urls = Array.from({ length: 12 }, (_, i) => `https://shop.example/${i}.jpg`);
    await enqueueImageMirrors(projectId, productId, urls);
    // Slow enough that both passes select the same candidates before either claims.
    const slow = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { buffer: PNG, contentType: 'image/jpeg' };
    }) as unknown as typeof fetchRemoteImage;

    const [a, b] = await Promise.all([
      mirrorQueuedImages({ fetcher: slow, batch: 12 }),
      mirrorQueuedImages({ fetcher: slow, batch: 12 })
    ]);

    expect(a + b).toBe(12);
    expect(slow).toHaveBeenCalledTimes(12);
    expect(storage.uploadBuffer).toHaveBeenCalledTimes(12);
    const rows = await queueRows(productId);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.status === 'done' && r.attempts === 1)).toBe(true);
  });

  it('respects the batch size and takes the oldest rows first', async () => {
    const productId = await addProduct([]);
    const first = randomUUID();
    const second = randomUUID();
    await db.insert(imageMirrorQueue).values([
      {
        id: first,
        projectId,
        productId,
        sourceUrl: 'https://shop.example/old.jpg',
        createdAt: new Date('2026-01-01T00:00:00Z')
      },
      {
        id: second,
        projectId,
        productId,
        sourceUrl: 'https://shop.example/new.jpg',
        createdAt: new Date('2026-06-01T00:00:00Z')
      }
    ]);
    expect(await mirrorQueuedImages({ fetcher: okFetcher, batch: 1 })).toBe(1);
    const rows = await queueRows(productId);
    expect(rows.find((r) => r.id === first)?.status).toBe('done');
    expect(rows.find((r) => r.id === second)?.status).toBe('pending');
  });
});
