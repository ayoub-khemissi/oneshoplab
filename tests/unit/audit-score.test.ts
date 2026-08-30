/**
 * The audit engine is the product: what a merchant sees as their score and
 * their issues. Rules pinned here come from src/entities/audit/lib/score.ts; a change
 * to any threshold must update these tests (and the snapshot) deliberately.
 */
import { describe, expect, it } from 'vitest';
import { audit } from '@/entities/audit';
import {
  emptyProduct,
  images,
  perfectProduct,
  plainText,
  product,
  SHORT_TITLE
} from './audit-fixtures';

const one = (p: ReturnType<typeof product>, opts = {}) => audit([p], opts).allProducts[0];
const codes = (p: ReturnType<typeof product>, opts = {}) =>
  one(p, opts)
    .issues.map((i) => i.code)
    .sort();

describe('per-product scoring', () => {
  it('a complete product scores 100 with no issues', () => {
    const r = one(perfectProduct());
    expect(r.score).toBe(100);
    expect(r.issues).toEqual([]);
  });

  it('an empty product scores 0 and reports every structural issue', () => {
    const r = one(emptyProduct());
    expect(r.score).toBe(0);
    expect(codes(emptyProduct())).toEqual(['no_description', 'no_image', 'no_tags']);
  });

  it.each([
    [0, 60, ['no_image']],
    [1, 81, ['single_image']],
    [2, 90, []],
    [3, 96, []],
    [4, 100, []]
  ])('%i image(s) → score %i, issues %j', (n, score, expected) => {
    const p = product({ images: images(n) });
    expect(one(p).score).toBe(score);
    expect(codes(p)).toEqual(expected);
  });

  it('description length drives copy quality and the issue code', () => {
    expect(codes(product({ descriptionHtml: '' }))).toEqual(['no_description']);
    expect(codes(product({ descriptionHtml: plainText(80) }))).toEqual(['short_description']);
    expect(codes(product({ descriptionHtml: plainText(200) }))).toEqual([
      'unstructured_description'
    ]);
    // ≥300 chars of plain text: no issue, but the 0.85 structure malus applies.
    const plain = one(product({ descriptionHtml: plainText(700) }));
    expect(plain.issues).toEqual([]);
    expect(plain.score).toBe(96);
    expect(
      one(product({ descriptionHtml: `<p>${plainText(700)}</p><ul><li>x</li></ul>` })).score
    ).toBe(100);
  });

  it('title: short_title only under 20 chars; 20–29 and >70 lose points silently', () => {
    expect(codes(product({ title: SHORT_TITLE }))).toEqual(['short_title']);
    expect(one(product({ title: 'Twenty-two characters!' })).score).toBe(96);
    expect(one(product({ title: 'x'.repeat(80) })).score).toBe(96);
    expect(one(product({ title: 'x'.repeat(80) })).issues).toEqual([]);
  });

  it('tags: 5+ full marks, 3–4 partial, 1–2 low, 0 flagged', () => {
    expect(one(product({ tags: ['a', 'b', 'c'] })).score).toBe(96);
    expect(one(product({ tags: ['a'] })).score).toBe(91);
    expect(codes(product({ tags: [] }))).toEqual(['no_tags']);
    expect(one(product({ tags: [] })).score).toBe(85);
  });

  it('alt text: missing alt is reported with counts and costs up to 10 points', () => {
    const p = product({ images: [...images(2), ...images(2, { alt: '' })] });
    const r = one(p);
    expect(r.issues).toEqual([{ code: 'missing_alt_text', data: { missing: 2, total: 4 } }]);
    expect(r.score).toBe(95);
    expect(one(product({ images: images(4, { alt: null }) })).score).toBe(90);
  });

  it('skipAltText (manual catalogs): no alt issue, and 100 is still reachable', () => {
    const p = product({ images: images(4, { alt: null }) });
    expect(one(p, { skipAltText: true }).score).toBe(100);
    expect(codes(p, { skipAltText: true })).toEqual([]);
  });

  it('flags the smallest image under 800 px', () => {
    const p = product({ images: [...images(3), image640()] });
    expect(one(p).issues).toEqual([{ code: 'low_resolution_image', data: { width: 640 } }]);
  });
});

function image640() {
  return images(1, { width: 640, height: 640 })[0];
}

describe('catalog report', () => {
  it('empty catalog → empty report, no NaN', () => {
    const r = audit([]);
    expect(r.sampled).toBe(0);
    expect(r.avgProductScore).toBe(0);
    expect(Number.isNaN(r.scores.overall)).toBe(false);
  });

  it('orders worst-first and picks worst/best/latest as documented', () => {
    const catalog = [
      product({ sourceId: 'a', handle: 'a', sourceUpdatedAt: new Date('2026-01-01') }),
      product({ sourceId: 'b', handle: 'b', images: [], sourceUpdatedAt: new Date('2026-03-01') }),
      product({ sourceId: 'c', handle: 'c', tags: [], sourceUpdatedAt: new Date('2026-02-01') }),
      emptyProduct()
    ];
    const r = audit(catalog);
    expect(r.sampled).toBe(4);
    expect(r.allProducts.map((p) => p.handle)).toEqual(['empty', 'b', 'c', 'a']);
    expect(r.worstProducts[0].handle).toBe('empty');
    expect(r.bestProducts[0].handle).toBe('a');
    expect(r.latestProducts.map((p) => p.handle)).toEqual(['b', 'c', 'a']);
    expect(r.avgProductScore).toBe(Math.round((100 + 60 + 85 + 0) / 4));
    expect(r.lastProductUpdated?.toISOString()).toBe(new Date('2026-03-01').toISOString());
  });

  it('distribution and top lists count what is in the catalog', () => {
    const r = audit([
      product({ vendor: 'Atelier', productType: 'Mug', tags: ['mug', 'gift'] }),
      product({
        vendor: 'Atelier',
        productType: 'Bowl',
        tags: ['bowl', 'gift'],
        images: images(1)
      }),
      product({ vendor: 'Other', productType: 'Mug', tags: ['mug'], images: [] })
    ]);
    expect(r.distribution.imagesZero).toBe(1);
    expect(r.distribution.imagesOne).toBe(1);
    expect(r.topVendors[0]).toEqual({ value: 'Atelier', count: 2 });
    expect(r.topProductTypes[0]).toEqual({ value: 'Mug', count: 2 });
    expect(r.topTags[0]).toEqual({ value: 'mug', count: 2 });
  });

  it('realistic mixed catalog — snapshot (rule changes must be deliberate)', () => {
    const r = audit([
      perfectProduct(),
      product({ sourceId: '2', handle: 'b', images: images(2, { alt: '' }), tags: ['a', 'b'] }),
      product({ sourceId: '3', handle: 'c', descriptionHtml: plainText(150), title: SHORT_TITLE }),
      emptyProduct()
    ]);
    expect({
      scores: r.scores,
      avg: r.avgProductScore,
      averages: r.averages,
      products: r.allProducts.map((p) => ({ handle: p.handle, score: p.score, issues: p.issues }))
    }).toMatchSnapshot();
  });
});
