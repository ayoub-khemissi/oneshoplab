/**
 * `approveImageOpsAction` — the editor's "Appliquer" (docs/api/IMAGE-OPS.md §4).
 * The client is never trusted: ownership, the verbs the connection declared,
 * the photo cap, the last-image rule and the freshness of every target are all
 * decided again here.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId, plan: 'pro' } } : null)
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { approveImageOpsAction } from '@/features/apply-to-store/actions';
import { db } from '@/shared/db';
import {
  connectionCapabilities,
  productChanges,
  products,
  type ConnectionCapabilities
} from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

const GEN = 'https://cdn.test/gen-a.jpg';
const WOO: ConnectionCapabilities = {
  stableImageIds: true,
  imageOps: ['set_featured', 'append', 'replace', 'remove', 'set_alt', 'reorder'],
  maxImages: 30,
  altEditable: true,
  fields: ['title', 'description', 'tags', 'images']
};

let userId: string;
let projectId: string;
let product: { id: string; sourceId: string };

async function declare(caps: Partial<ConnectionCapabilities>): Promise<void> {
  await db
    .insert(connectionCapabilities)
    .values({ projectId, platform: 'woocommerce', capabilities: { ...WOO, ...caps } })
    .onDuplicateKeyUpdate({ set: { capabilities: { ...WOO, ...caps } } });
}

async function changesOf(productId: string) {
  return db.select().from(productChanges).where(eq(productChanges.productId, productId));
}

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
  session.userId = userId;
  product = await createProduct(projectId, {
    sourceId: 'gallery',
    images: [
      { src: 'https://cdn.test/1.jpg', alt: 'One', width: null, height: null, sourceImageId: 'm1' },
      { src: 'https://cdn.test/2.jpg', alt: null, width: null, height: null, sourceImageId: 'm2' },
      { src: 'https://cdn.test/3.jpg', alt: null, width: null, height: null, sourceImageId: 'm3' }
    ]
  });
  await declare({});
});
afterAll(async () => {
  await db.$client.end();
});

describe('approveImageOpsAction', () => {
  it('turns one reviewed queue into ONE pending change carrying the ops', async () => {
    const res = await approveImageOpsAction(product.id, [
      { op: 'set_featured', target: 'm3' },
      { op: 'remove', target: 'm1' },
      { op: 'set_alt', target: 'm2', alt: 'Mug on a wooden table' }
    ]);
    expect(res.ok).toBe(true);
    const rows = await changesOf(product.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe('images');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].value).toEqual({
      v: 1,
      ops: [
        { op: 'set_featured', target: 'm3' },
        { op: 'remove', target: 'm1' },
        { op: 'set_alt', target: 'm2', alt: 'Mug on a wooden table' }
      ]
    });
    // prior_value keeps the ids so "Annuler" can put the gallery back (§3).
    expect(rows[0].priorValue).toEqual([
      { src: 'https://cdn.test/1.jpg', alt: 'One', sourceImageId: 'm1', position: 0 },
      { src: 'https://cdn.test/2.jpg', alt: null, sourceImageId: 'm2', position: 1 },
      { src: 'https://cdn.test/3.jpg', alt: null, sourceImageId: 'm3', position: 2 }
    ]);
    // No new image in the payload → no retention deadline to race.
    expect(rows[0].expiresAt).toBeNull();
  });

  it('gives a change that carries a generated visual the retention deadline', async () => {
    const res = await approveImageOpsAction(product.id, [
      { op: 'append', image: { src: GEN, alt: 'Lifestyle' } },
      { op: 'reorder', order: ['new:0', 'm1', 'm2', 'm3'] }
    ]);
    expect(res.ok).toBe(true);
    const [row] = await changesOf(product.id);
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses anonymous callers and someone else’s product', async () => {
    session.userId = null;
    expect(await approveImageOpsAction(product.id, [{ op: 'remove', target: 'm1' }])).toEqual({
      ok: false,
      error: 'unauthorized'
    });
    session.userId = await createUser();
    expect(await approveImageOpsAction(product.id, [{ op: 'remove', target: 'm1' }])).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(await changesOf(product.id)).toHaveLength(0);
  });

  it('rejects a malformed or unknown verb before anything else', async () => {
    for (const ops of [
      [],
      'nope',
      [{ op: 'detach', target: 'm1' }],
      [{ op: 'remove' }],
      [{ op: 'set_featured', target: 'm1', image: { src: GEN } }],
      [{ op: 'append', image: { src: 'not-a-url' } }]
    ]) {
      expect(await approveImageOpsAction(product.id, ops)).toEqual({
        ok: false,
        error: 'bad_request'
      });
    }
    expect(await approveImageOpsAction('not-a-uuid', [{ op: 'remove', target: 'm1' }])).toEqual({
      ok: false,
      error: 'bad_request'
    });
    expect(await changesOf(product.id)).toHaveLength(0);
  });

  it('offers nothing the connection did not declare, whatever the client sends', async () => {
    // Wix: add / replace / remove only, and no stable-id-less store at all.
    await declare({ imageOps: ['append', 'replace', 'remove'] });
    expect(await approveImageOpsAction(product.id, [{ op: 'set_featured', target: 'm3' }])).toEqual(
      {
        ok: false,
        error: 'unsupported'
      }
    );
    expect(
      await approveImageOpsAction(product.id, [{ op: 'reorder', order: ['m3', 'm2', 'm1'] }])
    ).toEqual({ ok: false, error: 'unsupported' });
    expect((await approveImageOpsAction(product.id, [{ op: 'remove', target: 'm1' }])).ok).toBe(
      true
    );

    await db.delete(productChanges);
    await declare({ stableImageIds: false, imageOps: [] });
    expect(await approveImageOpsAction(product.id, [{ op: 'remove', target: 'm1' }])).toEqual({
      ok: false,
      error: 'unsupported'
    });
    expect(await changesOf(product.id)).toHaveLength(0);
  });

  it('never empties the gallery and never exceeds the store’s cap', async () => {
    expect(
      await approveImageOpsAction(product.id, [
        { op: 'remove', target: 'm1' },
        { op: 'remove', target: 'm2' },
        { op: 'remove', target: 'm3' }
      ])
    ).toEqual({ ok: false, error: 'last_image' });

    await declare({ maxImages: 3 });
    expect(
      await approveImageOpsAction(product.id, [{ op: 'append', image: { src: GEN, alt: null } }])
    ).toEqual({ ok: false, error: 'too_many_images', max: 3 });
    expect(await changesOf(product.id)).toHaveLength(0);
  });

  it('says so when a photo disappeared from the gallery since the page loaded', async () => {
    await db
      .update(products)
      .set({
        images: [
          {
            src: 'https://cdn.test/2.jpg',
            alt: null,
            width: null,
            height: null,
            sourceImageId: 'm2'
          }
        ]
      })
      .where(eq(products.id, product.id));
    expect(
      await approveImageOpsAction(product.id, [{ op: 'set_alt', target: 'm1', alt: 'x' }])
    ).toEqual({ ok: false, error: 'stale' });
    expect(
      await approveImageOpsAction(product.id, [{ op: 'reorder', order: ['m2', 'm9'] }])
    ).toEqual({ ok: false, error: 'stale' });
    expect(await changesOf(product.id)).toHaveLength(0);
  });

  it('refuses a product that left the store', async () => {
    await db.update(products).set({ status: 'archived' }).where(eq(products.id, product.id));
    expect(await approveImageOpsAction(product.id, [{ op: 'remove', target: 'm1' }])).toEqual({
      ok: false,
      error: 'archived'
    });
  });
});
