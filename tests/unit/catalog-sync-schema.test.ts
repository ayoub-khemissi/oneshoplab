import { describe, expect, it } from 'vitest';
import {
  MAX_DESCRIPTION_BYTES,
  MAX_IMAGES_PER_PRODUCT,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TITLE_LENGTH,
  SYNC_BATCH_SIZE,
  syncBodySchema
} from '@/features/catalog-sync';

const product = (sourceId: string, extra: Record<string, unknown> = {}) => ({
  sourceId,
  title: 'T',
  ...extra
});
const body = (products: unknown[], extra: Record<string, unknown> = {}) => ({
  mode: 'partial',
  products,
  ...extra
});
const fails = (b: unknown) => syncBodySchema.safeParse(b).success === false;

describe('sync body schema (spec §3 caps)', () => {
  it('accepts a minimal body and strips unknown fields', () => {
    const r = syncBodySchema.safeParse(body([product('a', { bogus: 1 })]));
    expect(r.success).toBe(true);
    expect(r.success && 'bogus' in r.data.products[0]).toBe(false);
  });
  it('caps the batch, images, tags, title and description', () => {
    const many = Array.from({ length: SYNC_BATCH_SIZE + 1 }, (_, i) => product(`p${i}`));
    expect(fails(body(many))).toBe(true);
    expect(fails(body(many.slice(0, SYNC_BATCH_SIZE)))).toBe(false);
    const images = Array.from({ length: MAX_IMAGES_PER_PRODUCT + 1 }, () => ({
      src: 'https://x.test/a.jpg'
    }));
    expect(fails(body([product('a', { images })]))).toBe(true);
    expect(fails(body([product('a', { images: images.slice(1) })]))).toBe(false);
    expect(fails(body([product('a', { tags: Array(MAX_TAGS + 1).fill('t') })]))).toBe(true);
    expect(fails(body([product('a', { tags: ['x'.repeat(MAX_TAG_LENGTH + 1)] })]))).toBe(true);
    expect(fails(body([product('a', { tags: ['x'.repeat(MAX_TAG_LENGTH)] })]))).toBe(false);
    expect(fails(body([product('a', { title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })]))).toBe(true);
    expect(
      fails(body([product('a', { descriptionHtml: 'x'.repeat(MAX_DESCRIPTION_BYTES + 1) })]))
    ).toBe(true);
    expect(
      fails(body([product('a', { descriptionHtml: 'é'.repeat(MAX_DESCRIPTION_BYTES / 2) })]))
    ).toBe(false);
  });
  it('reports a duplicate sourceId with its index', () => {
    const r = syncBodySchema.safeParse(body([product('a'), product('b'), product('a')]));
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].path).toEqual(['products', 2, 'sourceId']);
  });
  it('accepts sourceImageId on an image and a capabilities object (IMAGE-OPS §1, §7)', () => {
    const r = syncBodySchema.safeParse(
      body([product('a', { images: [{ src: 'https://x.test/a.jpg', sourceImageId: '4711' }] })], {
        capabilities: { stableImageIds: true, imageOps: ['append', 'remove'], maxImages: 10 }
      })
    );
    expect(r.success).toBe(true);
    expect(r.success && r.data.products[0].images?.[0].sourceImageId).toBe('4711');
    expect(r.success && r.data.capabilities?.imageOps).toEqual(['append', 'remove']);
    // Both are optional — an older plugin sends neither.
    expect(fails(body([product('a', { images: [{ src: 'https://x.test/a.jpg' }] })]))).toBe(false);
    expect(fails(body([product('a')], { capabilities: { imageOps: ['teleport'] } }))).toBe(true);
  });

  it('requires mode, sourceId and title', () => {
    expect(fails({ products: [] })).toBe(true);
    expect(fails(body([{ title: 'x' }]))).toBe(true);
    expect(fails(body([{ sourceId: 'x' }]))).toBe(true);
    expect(fails(body([], { mode: 'full', session: 's', final: true }))).toBe(false);
  });
});
