/**
 * The image-ops payload rules (docs/api/IMAGE-OPS.md §2), the reverse-change
 * builder (§3) and the capability resolver's declarations/defaults (§7).
 */
import { describe, expect, it } from 'vitest';
import {
  MINIMUM_CAPABILITIES,
  PLATFORM_CAPABILITIES,
  capabilitiesSchema,
  normalizeCapabilities
} from '@/entities/connection-capability';
import {
  buildReverseValue,
  checkImageChangeValue,
  expectedImagesAfter,
  isImageOpsPayload,
  opRef,
  simulateImageOps,
  type ImageOp,
  type PriorImageRef
} from '@/entities/product-change';

const img = (id: string, src = `https://cdn.test/${id}.jpg`, alt: string | null = null) => ({
  sourceImageId: id,
  src,
  alt
});
const GALLERY: PriorImageRef[] = [img('m1'), img('m2', 'https://cdn.test/m2.jpg', 'Back')];
const ops = (...list: ImageOp[]) => ({ v: 1, ops: list });
const check = (value: unknown, prior: PriorImageRef[] = GALLERY) =>
  checkImageChangeValue(value, prior);

describe('images value shapes', () => {
  it('accepts the plain array as replace-all and the ops payload', () => {
    const array = check([{ src: 'https://cdn.test/new.jpg', alt: 'A' }]);
    expect(array.ok && array.kind).toBe('replace_all');
    const list = check(ops({ op: 'append', image: { src: 'https://cdn.test/new.jpg' } }));
    expect(list.ok && list.kind).toBe('ops');
    expect(isImageOpsPayload(ops({ op: 'remove', target: 'm1' }))).toBe(true);
    expect(isImageOpsPayload([{ src: 'https://cdn.test/a.jpg' }])).toBe(false);
  });

  it('rejects a malformed payload with the issues', () => {
    const bad = check({ v: 2, ops: [{ op: 'append' }] });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.rejection.code).toBe('invalid_ops');
    const unknownVerb = check(ops({ op: 'nope' } as unknown as ImageOp));
    expect(!unknownVerb.ok && unknownVerb.rejection.code).toBe('invalid_ops');
    // set_featured takes exactly one of image / target.
    expect(check(ops({ op: 'set_featured' } as ImageOp)).ok).toBe(false);
    expect(
      check(
        ops({
          op: 'set_featured',
          target: 'm1',
          image: { src: 'https://cdn.test/a.jpg' }
        } as ImageOp)
      ).ok
    ).toBe(false);
    expect(check(ops({ op: 'set_featured', target: 'm1' })).ok).toBe(true);
  });

  it('never lets a change remove the last image', () => {
    const wipe = check(ops({ op: 'remove', target: 'm1' }, { op: 'remove', target: 'm2' }));
    expect(!wipe.ok && wipe.rejection.code).toBe('removes_last_image');
    // Removing both but adding one back is fine.
    expect(
      check(
        ops(
          { op: 'remove', target: 'm1' },
          { op: 'remove', target: 'm2' },
          { op: 'append', image: { src: 'https://cdn.test/new.jpg' } }
        )
      ).ok
    ).toBe(true);
    expect(check(ops({ op: 'remove', target: 'm1' })).ok).toBe(true);
    // The replace-all shape too: an empty array is an empty gallery.
    const empty = check([]);
    expect(!empty.ok && empty.rejection.code).toBe('removes_last_image');
  });

  it('a product that never had a photo breaks no rule by still having none', () => {
    // Shopify's own demo catalog ships such a product. Refusing here put a red
    // "cannot be applied" under the image editor of every photoless product,
    // on load, with nothing queued.
    expect(simulateImageOps([], []).ok).toBe(true);
    expect(
      simulateImageOps([{ op: 'append', image: { src: 'https://cdn.test/first.jpg' } }], []).ok
    ).toBe(true);
  });

  it('resolves `new:<n>` against the images introduced earlier in the list', () => {
    const good = check(
      ops(
        { op: 'append', image: { src: 'https://cdn.test/a.jpg' } },
        { op: 'reorder', order: ['new:0', 'm1', 'm2'] }
      )
    );
    expect(good.ok).toBe(true);
    const forward = check(ops({ op: 'reorder', order: ['new:0'] }));
    expect(!forward.ok && forward.rejection).toEqual({
      code: 'unknown_image_ref',
      ref: 'new:0'
    });
    const outOfRange = check(
      ops(
        { op: 'append', image: { src: 'https://cdn.test/a.jpg' } },
        { op: 'remove', target: 'new:1' }
      )
    );
    expect(!outOfRange.ok && outOfRange.rejection).toEqual({
      code: 'unknown_image_ref',
      ref: 'new:1'
    });
  });

  it('a target the store no longer has is skipped, not fatal', () => {
    const sim = simulateImageOps(
      [
        { op: 'remove', target: 'gone' },
        { op: 'set_alt', target: 'm2', alt: 'New alt' }
      ],
      GALLERY
    );
    expect(sim.ok).toBe(true);
    expect(sim.ok && sim.simulation.unresolved).toEqual(['0:remove']);
    expect(sim.ok && sim.simulation.images.map((i) => i.alt)).toEqual([null, 'New alt']);
    expect(opRef(2, { op: 'remove', target: 'x' })).toBe('2:remove');
  });

  it('predicts the resulting gallery for both shapes', () => {
    expect(
      expectedImagesAfter(
        ops(
          { op: 'remove', target: 'm1' },
          { op: 'set_featured', image: { src: 'https://cdn.test/hero.jpg', alt: 'Hero' } }
        ),
        GALLERY
      )
    ).toEqual([
      { src: 'https://cdn.test/hero.jpg', alt: 'Hero' },
      { src: 'https://cdn.test/m2.jpg', alt: 'Back' }
    ]);
    expect(expectedImagesAfter([{ src: 'https://cdn.test/x.jpg' }], GALLERY)).toEqual([
      { src: 'https://cdn.test/x.jpg', alt: null }
    ]);
    expect(expectedImagesAfter({ v: 9 }, GALLERY)).toBeNull();
  });
});

describe('reverse change builder', () => {
  it('text fields restore their prior value verbatim', () => {
    expect(buildReverseValue('title', 'Old', 'New')).toEqual({ ok: true, value: 'Old' });
    expect(buildReverseValue('tags', ['a', 'b'], ['c'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(buildReverseValue('description', null, 'x')).toEqual({ ok: false, reason: 'no_prior' });
    expect(buildReverseValue('title', { nope: 1 }, 'x')).toEqual({
      ok: false,
      reason: 'not_reversible'
    });
  });

  it('a replace-all change is reversed by the prior array (exact restore)', () => {
    expect(buildReverseValue('images', GALLERY, [{ src: 'https://cdn.test/gen.jpg' }])).toEqual({
      ok: true,
      value: [
        { src: 'https://cdn.test/m1.jpg', alt: null },
        { src: 'https://cdn.test/m2.jpg', alt: 'Back' }
      ]
    });
  });

  it('an ops change is reversed with ops when every prior image has an id', () => {
    const reverse = buildReverseValue('images', GALLERY, ops({ op: 'remove', target: 'm1' }));
    expect(reverse).toEqual({
      ok: true,
      value: ops(
        { op: 'set_alt', target: 'm1', alt: '' },
        { op: 'set_alt', target: 'm2', alt: 'Back' },
        { op: 'reorder', order: ['m1', 'm2'] }
      )
    });
    // One image without an id → the addressable path is off, plain array again.
    const mixed = buildReverseValue(
      'images',
      [GALLERY[0], { src: 'https://cdn.test/legacy.jpg', alt: null }],
      ops({ op: 'remove', target: 'm1' })
    );
    expect(mixed.ok && Array.isArray(mixed.value)).toBe(true);
  });

  it('refuses to restore an empty gallery', () => {
    expect(buildReverseValue('images', [], ops({ op: 'remove', target: 'm1' }))).toEqual({
      ok: false,
      reason: 'not_reversible'
    });
  });
});

describe('capabilities', () => {
  it('the minimum is replace-all only', () => {
    expect(MINIMUM_CAPABILITIES).toEqual({
      stableImageIds: false,
      imageOps: [],
      maxImages: 30,
      altEditable: false,
      fields: ['title', 'description', 'tags', 'images']
    });
  });

  it('an empty report degrades to the minimum, holes are filled', () => {
    expect(normalizeCapabilities({})).toEqual(MINIMUM_CAPABILITIES);
    expect(normalizeCapabilities({ stableImageIds: true, imageOps: ['append'] })).toEqual({
      ...MINIMUM_CAPABILITIES,
      stableImageIds: true,
      imageOps: ['append']
    });
    // Ops without stable ids cannot address anything: dropped, never offered.
    expect(normalizeCapabilities({ imageOps: ['remove'] }).imageOps).toEqual([]);
  });

  it('rejects a nonsense report', () => {
    expect(capabilitiesSchema.safeParse({ imageOps: ['teleport'] }).success).toBe(false);
    expect(capabilitiesSchema.safeParse({ maxImages: 0 }).success).toBe(false);
    expect(capabilitiesSchema.safeParse({ maxImages: 10_000 }).success).toBe(false);
    expect(capabilitiesSchema.safeParse({ fields: ['price'] }).success).toBe(false);
  });

  it('declares what each connector can honestly do', () => {
    // Shopify: no set_alt (needs the write_files scope we do not request).
    expect(PLATFORM_CAPABILITIES.shopify).toMatchObject({
      stableImageIds: true,
      imageOps: ['set_featured', 'append', 'replace', 'remove', 'reorder'],
      altEditable: false
    });
    // Wix Stores v1: add + remove only, no ordering, no per-item update.
    expect(PLATFORM_CAPABILITIES.wix).toMatchObject({
      stableImageIds: true,
      imageOps: ['append', 'replace', 'remove'],
      maxImages: 15
    });
  });
});
