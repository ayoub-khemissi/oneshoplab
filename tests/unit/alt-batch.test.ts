/**
 * The pure rules behind "Générer les textes alternatifs manquants": what one
 * run covers, what it queues, and which stores are offered the action at all.
 */
import { describe, expect, it } from 'vitest';
import {
  ALT_BATCH_MAX_IMAGES,
  buildSetAltOps,
  countMissingAltFromIssues,
  isMissingAlt,
  planAltBatch,
  type AltCandidateProduct
} from '@/features/generate-alt-text/lib/batch';
import { canGenerateAlt, canRunAltBatch } from '@/features/generate-alt-text/lib/capability';
import type { ConnectionCapabilities } from '@/shared/db/schema';

function candidate(productId: string, images: number): AltCandidateProduct {
  return {
    productId,
    title: productId,
    images: Array.from({ length: images }, (_, i) => ({
      src: `https://cdn.test/${productId}-${i}.jpg`,
      sourceImageId: `${productId}-${i}`
    }))
  };
}

const WOO: ConnectionCapabilities = {
  stableImageIds: true,
  imageOps: ['set_featured', 'append', 'replace', 'remove', 'set_alt', 'reorder'],
  maxImages: 30,
  altEditable: true,
  fields: ['title', 'description', 'tags', 'images']
};

describe('isMissingAlt', () => {
  it('treats blank as missing and a real sentence as present', () => {
    expect(isMissingAlt(null)).toBe(true);
    expect(isMissingAlt('')).toBe(true);
    expect(isMissingAlt('   ')).toBe(true);
    expect(isMissingAlt('Mug en grès')).toBe(false);
  });
});

describe('planAltBatch', () => {
  it('takes everything when the catalog fits under the cap', () => {
    const plan = planAltBatch([candidate('a', 2), candidate('b', 3)]);
    expect(plan.images).toBe(5);
    expect(plan.remaining).toBe(0);
    expect(plan.products.map((p) => p.productId)).toEqual(['a', 'b']);
  });

  it('caps the run and reports what is left for the next one', () => {
    const plan = planAltBatch([candidate('a', 20), candidate('b', 20)], 25);
    expect(plan.images).toBe(25);
    expect(plan.remaining).toBe(15);
    expect(plan.products).toHaveLength(2);
    expect(plan.products[1].images).toHaveLength(5);
  });

  it('splits a single oversized product rather than blocking on it', () => {
    const plan = planAltBatch([candidate('huge', 60)], 25);
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0].images).toHaveLength(25);
    expect(plan.remaining).toBe(35);
  });

  it('defaults to the documented ceiling', () => {
    expect(ALT_BATCH_MAX_IMAGES).toBe(25);
    expect(planAltBatch([candidate('a', 40)]).images).toBe(ALT_BATCH_MAX_IMAGES);
  });

  it('is empty when nothing is missing', () => {
    const plan = planAltBatch([]);
    expect(plan).toEqual({ products: [], images: 0, remaining: 0 });
  });
});

describe('buildSetAltOps', () => {
  const images = candidate('p', 3).images;

  it('emits ONLY set_alt ops, one per described photo', () => {
    const ops = buildSetAltOps(images, { 'p-0': 'Mug en grès', 'p-1': 'Anse du mug' });
    expect(ops).toEqual([
      { op: 'set_alt', target: 'p-0', alt: 'Mug en grès' },
      { op: 'set_alt', target: 'p-1', alt: 'Anse du mug' }
    ]);
    expect(ops.every((o) => o.op === 'set_alt')).toBe(true);
  });

  it('skips a photo the model returned nothing usable for', () => {
    expect(buildSetAltOps(images, { 'p-0': '', 'p-1': '   ' })).toEqual([]);
  });

  it('trims what it queues', () => {
    expect(buildSetAltOps(images.slice(0, 1), { 'p-0': '  Mug en grès  ' })).toEqual([
      { op: 'set_alt', target: 'p-0', alt: 'Mug en grès' }
    ]);
  });
});

describe('countMissingAltFromIssues', () => {
  it('sums the audit tally and ignores every other issue', () => {
    expect(
      countMissingAltFromIssues([
        { issues: [{ code: 'missing_alt_text', data: { missing: 2, total: 4 } }] },
        { issues: [{ code: 'no_tags' }, { code: 'missing_alt_text', data: { missing: 1 } }] },
        { issues: [{ code: 'no_image' }] },
        {}
      ])
    ).toBe(3);
  });

  it('is zero on a clean catalog', () => {
    expect(countMissingAltFromIssues([{ issues: [] }])).toBe(0);
  });
});

describe('capability gating', () => {
  it('offers the action on a store that declared set_alt and altEditable', () => {
    expect(canGenerateAlt(WOO, 'store')).toBe(true);
    expect(canRunAltBatch(WOO)).toBe(true);
  });

  it('never offers it when the store cannot edit an existing alt', () => {
    // Shopify: `fileUpdate` needs a scope we don't request (IMAGE-OPS.md §7).
    const shopify: ConnectionCapabilities = {
      ...WOO,
      imageOps: ['set_featured', 'append', 'replace', 'remove', 'reorder'],
      altEditable: false
    };
    expect(canGenerateAlt(shopify, 'store')).toBe(false);
    expect(canRunAltBatch(shopify)).toBe(false);
    // A generation still carries its alt at creation time.
    expect(canGenerateAlt(shopify, 'generated')).toBe(true);
  });

  it('refuses a store that declares altEditable without the verb, and the reverse', () => {
    expect(canGenerateAlt({ ...WOO, altEditable: false }, 'store')).toBe(false);
    expect(canGenerateAlt({ ...WOO, imageOps: ['append', 'replace', 'remove'] }, 'store')).toBe(
      false
    );
  });

  it('refuses everything without stable image ids — nothing can be addressed', () => {
    const minimum: ConnectionCapabilities = {
      stableImageIds: false,
      imageOps: [],
      maxImages: 30,
      altEditable: false,
      fields: ['title', 'description', 'tags', 'images']
    };
    expect(canGenerateAlt(minimum, 'store')).toBe(false);
    expect(canGenerateAlt(minimum, 'generated')).toBe(false);
    expect(canRunAltBatch(minimum)).toBe(false);
  });

  it('wix (add + remove only) gets neither the batch nor the per-photo action', () => {
    const wix: ConnectionCapabilities = {
      ...WOO,
      imageOps: ['append', 'replace', 'remove'],
      maxImages: 15,
      altEditable: false
    };
    expect(canRunAltBatch(wix)).toBe(false);
    expect(canGenerateAlt(wix, 'generated')).toBe(true);
  });
});
