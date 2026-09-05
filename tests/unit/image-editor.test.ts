/**
 * Pure rules of the product image editor (docs/api/IMAGE-OPS.md §4): which
 * action a capability set unlocks, how clicks become an ordered op list, and
 * how the queue reads in plain words.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_QUEUE,
  describeOp,
  hasPerImageActions,
  moveRef,
  normalizeOrder,
  previewQueue,
  pushOp,
  removeQueuedOp,
  tileActions,
  withAltForSrc,
  type EditorImage,
  type EditorQueue,
  type RefNamer,
  type TileContext
} from '@/features/apply-to-store/lib/image-editor';
import { buildGrid } from '@/features/apply-to-store/lib/image-editor-grid';
import { shopifyCapabilitiesFor } from '@/entities/connection-capability';
import type { ConnectionCapabilities } from '@/shared/db/schema';

const MINIMUM: ConnectionCapabilities = {
  stableImageIds: false,
  imageOps: [],
  maxImages: 30,
  altEditable: false,
  fields: ['title', 'description', 'tags', 'images']
};
const WOO: ConnectionCapabilities = {
  stableImageIds: true,
  imageOps: ['set_featured', 'append', 'replace', 'remove', 'set_alt', 'reorder'],
  maxImages: 30,
  altEditable: true,
  fields: ['title', 'description', 'tags', 'images']
};
const SHOPIFY: ConnectionCapabilities = {
  stableImageIds: true,
  imageOps: ['set_featured', 'append', 'replace', 'remove', 'reorder'],
  maxImages: 250,
  altEditable: false,
  fields: ['title', 'description', 'tags', 'images']
};
const WIX: ConnectionCapabilities = {
  stableImageIds: true,
  imageOps: ['append', 'replace', 'remove'],
  maxImages: 15,
  altEditable: false,
  fields: ['title', 'description', 'tags', 'images']
};

const storeImages = [
  { src: 'https://cdn.test/1.jpg', alt: 'One', sourceImageId: 'm1' },
  { src: 'https://cdn.test/2.jpg', alt: null, sourceImageId: 'm2' },
  { src: 'https://cdn.test/3.jpg', alt: null, sourceImageId: 'm3' }
];
const generated = [
  { jobId: 'j1', src: 'https://cdn.test/gen-a.jpg', alt: null },
  { jobId: 'j2', src: 'https://cdn.test/gen-b.jpg', alt: null }
];

const storeTile = (i = 0): EditorImage => ({
  key: `store-${i}`,
  kind: 'store',
  src: storeImages[i].src,
  alt: storeImages[i].alt,
  sourceImageId: storeImages[i].sourceImageId,
  index: i + 1
});
const genTile = (i = 0): EditorImage => ({
  key: `gen-${i}`,
  kind: 'generated',
  src: generated[i].src,
  alt: null,
  sourceImageId: null,
  index: i + 1
});
const ctx = (over: Partial<TileContext> = {}): TileContext => ({
  capabilities: WOO,
  previewCount: 3,
  generatedCount: 2,
  everyStoreImageAddressable: true,
  inGallery: true,
  isMain: false,
  ...over
});

function queueOf(...ops: Parameters<typeof pushOp>[1][]): EditorQueue {
  return ops.reduce<EditorQueue>((q, op, i) => pushOp(q, op, `op-${i}`), EMPTY_QUEUE);
}

describe('image editor — capabilities decide the buttons', () => {
  it('offers nothing without stable ids (the §5 fallback)', () => {
    expect(tileActions(storeTile(), ctx({ capabilities: MINIMUM }))).toEqual({
      setFeatured: false,
      append: false,
      replace: false,
      remove: false,
      setAlt: false,
      move: false
    });
    expect(hasPerImageActions(MINIMUM)).toBe(false);
    expect(hasPerImageActions(WOO)).toBe(true);
    expect(hasPerImageActions({ ...WOO, imageOps: [] })).toBe(false);
  });

  it('offers everything the WooCommerce plugin declares', () => {
    expect(tileActions(storeTile(), ctx())).toEqual({
      setFeatured: true,
      append: false,
      replace: true,
      remove: true,
      setAlt: true,
      move: true
    });
    expect(tileActions(genTile(), ctx({ inGallery: false }))).toMatchObject({
      append: true,
      setFeatured: true,
      remove: false,
      replace: false,
      setAlt: true,
      move: false
    });
  });

  it('hides alt on Shopify and order/main on Wix', () => {
    expect(tileActions(storeTile(), ctx({ capabilities: SHOPIFY })).setAlt).toBe(false);
    expect(tileActions(storeTile(), ctx({ capabilities: SHOPIFY })).move).toBe(true);
    const wix = tileActions(storeTile(), ctx({ capabilities: WIX }));
    expect(wix).toMatchObject({ setFeatured: false, move: false, setAlt: false, remove: true });
  });

  it('never offers what would break the product or the store', () => {
    // Last photo left → no removal.
    expect(tileActions(storeTile(), ctx({ previewCount: 1 })).remove).toBe(false);
    // No generation → nothing to replace with.
    expect(tileActions(storeTile(), ctx({ generatedCount: 0 })).replace).toBe(false);
    // Store cap reached → no addition.
    expect(tileActions(genTile(), ctx({ inGallery: false, previewCount: 30 })).append).toBe(false);
    // A photo the store never gave an id to cannot be addressed at all.
    expect(tileActions({ ...storeTile(), sourceImageId: null }, ctx()).setAlt).toBe(false);
    // One unaddressable photo disables reordering for the whole gallery.
    expect(tileActions(storeTile(), ctx({ everyStoreImageAddressable: false })).move).toBe(false);
  });
});

describe('image editor — queue assembly', () => {
  it('replays the queue over the store gallery', () => {
    const queue = queueOf(
      { op: 'set_featured', target: 'm3' },
      { op: 'remove', target: 'm1' },
      { op: 'append', image: { src: generated[0].src, alt: 'Lifestyle' } }
    );
    const preview = previewQueue(queue, storeImages);
    expect(preview.invalid).toBe(false);
    expect(preview.images.map((i) => i.ref)).toEqual(['m3', 'm2', 'new:0']);
    expect(preview.unresolved).toEqual([]);
    expect(preview.ops).toHaveLength(3);
  });

  it('keeps one decision per photo and per generated visual', () => {
    const twice = queueOf(
      { op: 'set_featured', target: 'm2' },
      { op: 'set_featured', target: 'm3' }
    );
    expect(twice.ops).toHaveLength(1);
    expect(twice.ops[0].op).toEqual({ op: 'set_featured', target: 'm3' });

    // Queuing "add to gallery" then "make it the main photo" on the SAME
    // visual must not put the image on the product twice.
    const one = queueOf(
      { op: 'append', image: { src: generated[0].src, alt: null } },
      { op: 'set_featured', image: { src: generated[0].src, alt: null } }
    );
    expect(one.ops).toHaveLength(1);
    expect(previewQueue(one, storeImages).images.map((i) => i.src)).toEqual([
      generated[0].src,
      ...storeImages.map((i) => i.src)
    ]);
  });

  it('reorder is rebuilt last, and follows what the queue added or removed', () => {
    const queue: EditorQueue = {
      ...queueOf({ op: 'append', image: { src: generated[0].src, alt: null } }),
      order: ['m3', 'm2', 'm1']
    };
    const preview = previewQueue(queue, storeImages);
    expect(preview.ops.at(-1)).toEqual({ op: 'reorder', order: ['m3', 'm2', 'm1', 'new:0'] });
    expect(preview.images.map((i) => i.ref)).toEqual(['m3', 'm2', 'm1', 'new:0']);

    expect(normalizeOrder(['m3', 'gone', 'm1'], ['m1', 'm2', 'm3'])).toEqual(['m3', 'm1', 'm2']);
    expect(moveRef(['m1', 'm2', 'm3'], 'm3', -1)).toEqual(['m1', 'm3', 'm2']);
    expect(moveRef(['m1', 'm2', 'm3'], 'm1', -1)).toEqual(['m1', 'm2', 'm3']);
    expect(moveRef(['m1', 'm2', 'm3'], 'm3', 1)).toEqual(['m1', 'm2', 'm3']);
  });

  it('flags a queue that would leave the product with no photo, and says why', () => {
    const queue = queueOf(
      { op: 'remove', target: 'm1' },
      { op: 'remove', target: 'm2' },
      { op: 'remove', target: 'm3' }
    );
    const preview = previewQueue(queue, storeImages);
    expect(preview.invalid).toBe(true);
    // The merchant is told the rule they hit — "keep one photo" — and not that
    // two of their changes conflict, which would be a hunt for nothing.
    expect(preview.invalidReason).toBe('removes_last_image');

    const fine = previewQueue(EMPTY_QUEUE, storeImages);
    expect(fine.images).toHaveLength(3);
    expect(fine.invalidReason).toBeNull();
  });

  it('a single removal on a one-photo product is the same rule', () => {
    const onlyPhoto = [storeImages[0]];
    const preview = previewQueue(queueOf({ op: 'remove', target: 'm1' }), onlyPhoto);
    expect(preview.invalid).toBe(true);
    expect(preview.invalidReason).toBe('removes_last_image');
  });

  it('says nothing on a product that has no photo to begin with', () => {
    const preview = previewQueue(EMPTY_QUEUE, []);
    expect(preview.invalid).toBe(false);
    expect(preview.invalidReason).toBeNull();
  });

  it('an alt typed on a generated tile follows it into the queued op', () => {
    const queue = withAltForSrc(
      queueOf({ op: 'append', image: { src: generated[0].src, alt: null } }),
      generated[0].src,
      'Mug on a wooden table'
    );
    expect(queue.ops[0].op).toEqual({
      op: 'append',
      image: { src: generated[0].src, alt: 'Mug on a wooden table' }
    });
    const untouched = withAltForSrc(queue, 'https://cdn.test/other.jpg', 'x');
    expect(untouched.ops[0].op).toEqual(queue.ops[0].op);
  });

  it('drops one queued decision without touching the others', () => {
    const queue = queueOf({ op: 'remove', target: 'm1' }, { op: 'remove', target: 'm2' });
    const after = removeQueuedOp(queue, queue.ops[0].id);
    expect(after.ops.map((q) => q.op)).toEqual([{ op: 'remove', target: 'm2' }]);
  });
});

describe('image editor — plain words', () => {
  const namer: RefNamer = {
    byRef: (ref) => (ref === 'm1' ? 'Photo 1' : ref === 'm3' ? 'Photo 3' : 'this photo'),
    bySrc: (src) => (src === generated[0].src ? 'Generated visual 1' : 'this photo')
  };

  it('names every op after the tile the merchant clicked', () => {
    expect(describeOp({ op: 'set_featured', target: 'm3' }, namer)).toEqual({
      key: 'opSetFeatured',
      values: { photo: 'Photo 3' }
    });
    expect(
      describeOp({ op: 'set_featured', image: { src: generated[0].src, alt: null } }, namer)
    ).toEqual({ key: 'opSetFeaturedNew', values: { photo: 'Generated visual 1' } });
    expect(describeOp({ op: 'remove', target: 'm1' }, namer)).toEqual({
      key: 'opRemove',
      values: { photo: 'Photo 1' }
    });
    expect(
      describeOp({ op: 'replace', target: 'm1', image: { src: generated[0].src } }, namer)
    ).toEqual({ key: 'opReplace', values: { photo: 'Photo 1', other: 'Generated visual 1' } });
    expect(describeOp({ op: 'set_alt', target: 'm1', alt: 'x' }, namer).key).toBe('opSetAlt');
    expect(describeOp({ op: 'append', image: { src: generated[0].src } }, namer).key).toBe(
      'opAppend'
    );
    expect(describeOp({ op: 'reorder', order: ['m1'] }, namer)).toEqual({
      key: 'opReorder',
      values: {}
    });
  });

  it('numbers photos after the ORIGINAL gallery, whatever the queue did', () => {
    const queue = queueOf(
      { op: 'remove', target: 'm1' },
      { op: 'append', image: { src: generated[1].src, alt: null } }
    );
    const preview = previewQueue(queue, storeImages);
    const { tiles, namer: gridNamer } = buildGrid({
      storeImages,
      generated,
      previewImages: preview.images,
      altDrafts: { [generated[0].src]: 'Draft alt' },
      labels: {
        photo: (n) => `Photo ${n}`,
        generated: (n) => `Generated visual ${n}`,
        fallback: 'this photo'
      }
    });
    // Gallery first (photo 2, photo 3, the queued visual), then what is not
    // on the product yet.
    expect(tiles.map((t) => [t.label, t.kind, t.inGallery])).toEqual([
      ['Photo 2', 'store', true],
      ['Photo 3', 'store', true],
      ['Generated visual 2', 'generated', true],
      ['Generated visual 1', 'generated', false]
    ]);
    expect(tiles[0].position).toBe(0);
    expect(tiles[3].position).toBe(-1);
    expect(tiles[3].alt).toBe('Draft alt');
    expect(tiles[3].domRef).toBe('gen:j1');
    expect(gridNamer.byRef('m1')).toBe('Photo 1');
    expect(gridNamer.byRef('nope')).toBe('this photo');
    expect(gridNamer.bySrc(generated[1].src)).toBe('Generated visual 2');
  });

  it('labels an unaddressable photo by its position', () => {
    const noIds = [{ src: 'https://cdn.test/x.jpg', alt: null, sourceImageId: null }];
    const { tiles } = buildGrid({
      storeImages: noIds,
      generated: [],
      previewImages: previewQueue(EMPTY_QUEUE, noIds).images,
      altDrafts: {},
      labels: { photo: (n) => `Photo ${n}`, generated: (n) => `G${n}`, fallback: 'this photo' }
    });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ label: 'Photo 1', domRef: 'pos:0', sourceImageId: null });
  });
});

describe('the main photo', () => {
  it('is not offered "make this the main photo"', () => {
    // The op would move nothing, so the merchant clicks and watches the page
    // do exactly that. Reported in production on 2026-09-05.
    expect(tileActions(storeTile(0), ctx({ isMain: true })).setFeatured).toBe(false);
    expect(tileActions(storeTile(1), ctx({ isMain: false })).setFeatured).toBe(true);
  });
});

describe('Shopify alt editing follows the granted scopes', () => {
  it('is offered only when the store granted write_files', () => {
    // Claiming a verb the store will refuse is worse than admitting we lack it:
    // the merchant would queue a change that comes back failed.
    const without = shopifyCapabilitiesFor(['read_products', 'write_products']);
    expect(without.altEditable).toBe(false);
    expect(without.imageOps).not.toContain('set_alt');

    const withScope = shopifyCapabilitiesFor(['read_products', 'write_products', 'write_files']);
    expect(withScope.altEditable).toBe(true);
    expect(withScope.imageOps).toContain('set_alt');
  });

  it('survives a connection that recorded no scopes at all', () => {
    expect(shopifyCapabilitiesFor(null).altEditable).toBe(false);
    expect(shopifyCapabilitiesFor(undefined).altEditable).toBe(false);
  });
});
