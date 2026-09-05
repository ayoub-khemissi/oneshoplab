/**
 * AI alt text end to end against the real database: what it debits, what it
 * persists, what it queues, and the stores it refuses to run on. The provider
 * is stubbed at the chat-provider module — no test ever reaches an LLM.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted: shared mutable state must come from vi.hoisted.
const session = vi.hoisted(() => ({ userId: null as string | null, credits: 0 }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () =>
    session.userId
      ? { user: { id: session.userId, plan: 'pro', creditsBalance: session.credits } }
      : null
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const provider = vi.hoisted(() => ({
  text: '"Mug en grès posé sur une table en bois."',
  calls: [] as Array<{ system?: string; messages: unknown[]; model: { openrouterId: string } }>,
  fail: false
}));
vi.mock('@/entities/ai-provider/api/chat-provider', () => ({
  chatCompletion: async (req: {
    system?: string;
    messages: unknown[];
    model: { openrouterId: string };
  }) => {
    provider.calls.push(req);
    if (provider.fail) throw new Error('provider down');
    return {
      text: provider.text,
      creditsConsumed: 0,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      provider: 'openrouter' as const,
      model: req.model.openrouterId
    };
  },
  ChatProviderError: class ChatProviderError extends Error {},
  isOpenRouterConfigured: () => true,
  stripCodeFences: (t: string) => t
}));

import {
  generateAltTextAction,
  generateMissingAltForProductAction,
  planMissingAltTextAction
} from '@/features/generate-alt-text/actions';
import { db } from '@/shared/db';
import {
  connectionCapabilities,
  creditTransactions,
  jobs,
  productChanges,
  users,
  type ConnectionCapabilities
} from '@/shared/db/schema';
import { buckets, createUser, ledgerSum, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

const WOO: ConnectionCapabilities = {
  stableImageIds: true,
  imageOps: ['set_featured', 'append', 'replace', 'remove', 'set_alt', 'reorder'],
  maxImages: 30,
  altEditable: true,
  fields: ['title', 'description', 'tags', 'images']
};

/** Two photos without an alt, one with — the batch must touch only the two. */
const GALLERY = [
  {
    src: 'https://cdn.test/1.jpg',
    alt: 'Vue de face',
    width: null,
    height: null,
    sourceImageId: 'm1'
  },
  { src: 'https://cdn.test/2.jpg', alt: null, width: null, height: null, sourceImageId: 'm2' },
  { src: 'https://cdn.test/3.jpg', alt: '   ', width: null, height: null, sourceImageId: 'm3' }
];

let userId: string;
let projectId: string;
let product: { id: string; sourceId: string };

async function declare(caps: Partial<ConnectionCapabilities>): Promise<void> {
  const capabilities = { ...WOO, ...caps };
  await db
    .insert(connectionCapabilities)
    .values({ projectId, platform: 'woocommerce', capabilities })
    .onDuplicateKeyUpdate({ set: { capabilities } });
}

async function altJobs() {
  return db.select().from(jobs).where(eq(jobs.kind, 'kie_alt_text'));
}

async function changesOf(productId: string) {
  return db.select().from(productChanges).where(eq(productChanges.productId, productId));
}

async function debits() {
  return db
    .select()
    .from(creditTransactions)
    .where(
      and(eq(creditTransactions.userId, userId), eq(creditTransactions.reason, 'kie_alt_text'))
    );
}

beforeEach(async () => {
  await resetTables();
  provider.text = '"Mug en grès posé sur une table en bois."';
  provider.calls = [];
  provider.fail = false;
  userId = await createUser({ sub: 100 });
  projectId = await createProject(userId);
  session.userId = userId;
  session.credits = 100;
  product = await createProduct(projectId, { sourceId: 'mug', images: GALLERY });
  await declare({});
});
afterAll(async () => {
  await db.$client.end();
});

describe('generateAltTextAction (one tile)', () => {
  it('returns the sanitised sentence, debits once and persists one completed job', async () => {
    const res = await generateAltTextAction(product.id, 'https://cdn.test/2.jpg');
    expect(res).toEqual({
      ok: true,
      alt: 'Mug en grès posé sur une table en bois',
      creditsConsumed: 1,
      changeQueued: true
    });

    const rows = await altJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].projectId).toBe(projectId);
    expect(rows[0].productId).toBe(product.id);
    expect(rows[0].creditsCost).toBe(1);
    expect(rows[0].inputPayload).toMatchObject({
      productSourceId: 'mug',
      field: 'alt',
      imageSrc: 'https://cdn.test/2.jpg',
      imageSourceImageId: 'm2'
    });

    // Exactly one ledger row, and the balance still equals the ledger.
    expect(await debits()).toHaveLength(1);
    const after = await buckets(userId);
    expect(after.total).toBe(99);
    expect(await ledgerSum(userId)).toBe(after.total);
  });

  it('sends the photo as an image block to a vision model', async () => {
    await generateAltTextAction(product.id, 'https://cdn.test/2.jpg');
    expect(provider.calls).toHaveLength(1);
    const content = (provider.calls[0].messages[0] as { content: unknown[] }).content;
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://cdn.test/2.jpg' }
    });
    // The fast system model is a Claude one — every catalog entry sees.
    expect(provider.calls[0].model.openrouterId).toContain('anthropic/');
  });

  it('queues the set_alt itself, so the sentence is not lost on reload', async () => {
    // It used to return the alt and stop there: the merchant saw a sentence
    // that existed nowhere — not on the product, not on its way to the store,
    // gone on the next reload, while the page still read "no alt text". Found
    // in production on 2026-09-05.
    await generateAltTextAction(product.id, 'https://cdn.test/2.jpg');
    const changes = await changesOf(product.id);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('images');
    expect(changes[0].value).toEqual({
      v: 1,
      ops: [{ op: 'set_alt', target: 'm2', alt: 'Mug en grès posé sur une table en bois' }]
    });
  });

  it('refuses and spends nothing when the store cannot edit an alt', async () => {
    await declare({ altEditable: false, imageOps: ['append', 'replace', 'remove'] });
    const res = await generateAltTextAction(product.id, 'https://cdn.test/2.jpg');
    expect(res).toEqual({ ok: false, error: 'unsupported' });
    expect(await altJobs()).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
    expect((await buckets(userId)).total).toBe(100);
  });

  it('refuses before any job when the balance cannot cover it', async () => {
    await db.update(users).set({ creditsBalance: 0 }).where(eq(users.id, userId));
    session.credits = 0;
    const res = await generateAltTextAction(product.id, 'https://cdn.test/2.jpg');
    expect(res).toEqual({ ok: false, error: 'insufficient_credits' });
    expect(await altJobs()).toHaveLength(0);
  });

  it('never leaks the provider error, and leaves the job failed', async () => {
    provider.fail = true;
    const res = await generateAltTextAction(product.id, 'https://cdn.test/2.jpg');
    expect(res).toEqual({ ok: false, error: 'generation_failed' });
    const rows = await altJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    // Nothing was delivered, so nothing was debited.
    expect(await debits()).toHaveLength(0);
    expect((await buckets(userId)).total).toBe(100);
  });

  it('checks ownership, not just authentication', async () => {
    session.userId = await createUser({ sub: 100 });
    expect(await generateAltTextAction(product.id, 'https://cdn.test/2.jpg')).toEqual({
      ok: false,
      error: 'not_found'
    });
    session.userId = null;
    expect(await generateAltTextAction(product.id, 'https://cdn.test/2.jpg')).toEqual({
      ok: false,
      error: 'unauthorized'
    });
  });
});

describe('planMissingAltTextAction (the batch, priced before it runs)', () => {
  it('counts only the photos that are addressable and blank', async () => {
    const plan = await planMissingAltTextAction(projectId);
    expect(plan).toEqual({
      ok: true,
      products: [{ productId: product.id, title: 'Old title', images: 2 }],
      images: 2,
      remaining: 0,
      cost: 2
    });
  });

  it('caps a run at 25 photos and reports the rest', async () => {
    await createProduct(projectId, {
      sourceId: 'many',
      images: Array.from({ length: 30 }, (_, i) => ({
        src: `https://cdn.test/many-${i}.jpg`,
        alt: null,
        width: null,
        height: null,
        sourceImageId: `x${i}`
      }))
    });
    const plan = await planMissingAltTextAction(projectId);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.images).toBe(25);
    expect(plan.remaining).toBe(7);
    expect(plan.cost).toBe(25);
  });

  it('refuses when the balance cannot cover the whole run', async () => {
    session.credits = 1;
    expect(await planMissingAltTextAction(projectId)).toEqual({
      ok: false,
      error: 'insufficient_credits'
    });
  });

  it('refuses on a store that cannot carry a set_alt', async () => {
    await declare({ altEditable: false });
    expect(await planMissingAltTextAction(projectId)).toEqual({ ok: false, error: 'unsupported' });
  });

  it('says so when nothing is missing rather than charging for zero work', async () => {
    const clean = await createProject(userId, 'Clean shop');
    await db
      .insert(connectionCapabilities)
      .values({ projectId: clean, platform: 'woocommerce', capabilities: WOO });
    await createProduct(clean, {
      sourceId: 'done',
      images: [
        {
          src: 'https://cdn.test/a.jpg',
          alt: 'Décrite',
          width: null,
          height: null,
          sourceImageId: 'a'
        }
      ]
    });
    expect(await planMissingAltTextAction(clean)).toEqual({ ok: false, error: 'nothing_missing' });
  });
});

describe('generateMissingAltForProductAction (one product of the batch)', () => {
  it('queues ONE images change carrying only set_alt ops', async () => {
    const res = await generateMissingAltForProductAction(product.id);
    expect(res).toEqual({ ok: true, generated: 2, changeQueued: true });

    const changes = await changesOf(product.id);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('images');
    expect(changes[0].status).toBe('pending');
    expect(changes[0].value).toEqual({
      v: 1,
      ops: [
        { op: 'set_alt', target: 'm2', alt: 'Mug en grès posé sur une table en bois' },
        { op: 'set_alt', target: 'm3', alt: 'Mug en grès posé sur une table en bois' }
      ]
    });
    // `set_alt` adds no image, so nothing races the retention window.
    expect(changes[0].expiresAt).toBeNull();
  });

  it('debits one credit per photo, once, and keeps the ledger balanced', async () => {
    await generateMissingAltForProductAction(product.id);
    expect(await debits()).toHaveLength(2);
    expect(await altJobs()).toHaveLength(2);
    const after = await buckets(userId);
    expect(after.total).toBe(98);
    expect(await ledgerSum(userId)).toBe(after.total);
  });

  it('leaves the photo that already had an alt alone', async () => {
    await generateMissingAltForProductAction(product.id);
    const changes = await changesOf(product.id);
    const ops = (changes[0].value as { ops: Array<{ target: string }> }).ops;
    expect(ops.map((o) => o.target)).not.toContain('m1');
  });

  it('refuses on a store that cannot carry a set_alt, spending nothing', async () => {
    await declare({ imageOps: ['append', 'replace', 'remove'] });
    expect(await generateMissingAltForProductAction(product.id)).toEqual({
      ok: false,
      error: 'unsupported'
    });
    expect(await altJobs()).toHaveLength(0);
    expect(await changesOf(product.id)).toHaveLength(0);
  });

  it('queues nothing when the model produced nothing usable', async () => {
    provider.text = '""';
    const res = await generateMissingAltForProductAction(product.id);
    expect(res).toEqual({ ok: false, error: 'generation_failed' });
    expect(await changesOf(product.id)).toHaveLength(0);
  });

  it('says nothing_missing rather than queueing an empty change', async () => {
    await generateMissingAltForProductAction(product.id);
    // The products row still holds the blank alts (the change is only pending),
    // so re-running is the merchant's problem, not a crash — but a product
    // whose gallery has no blank alt at all is refused outright.
    const other = await createProduct(projectId, {
      sourceId: 'described',
      images: [
        {
          src: 'https://cdn.test/z.jpg',
          alt: 'Décrite',
          width: null,
          height: null,
          sourceImageId: 'z'
        }
      ]
    });
    expect(await generateMissingAltForProductAction(other.id)).toEqual({
      ok: false,
      error: 'nothing_missing'
    });
  });
});
