/**
 * The pure shaping behind the "changes waiting for your store" banner and its
 * modal: excerpts, photo wording, counts, grouping and the result line.
 */
import { describe, expect, it } from 'vitest';
import {
  addCounts,
  buildPendingDetail,
  countPending,
  dropSuperseded,
  EXCERPT_MAX,
  groupByProduct,
  imageOpDescriptions,
  priorImageRefs,
  resultParts,
  toExcerpt
} from '@/features/apply-to-store/lib/pending-summary';
import type { PendingChangeItem } from '@/features/apply-to-store/model/types';

const LABELS = { photo: (n: number) => `Photo ${n}`, added: 'a new photo' };

const PRIOR = [
  { src: 'https://cdn.test/1.jpg', alt: null, sourceImageId: 'm1', position: 0 },
  { src: 'https://cdn.test/2.jpg', alt: null, sourceImageId: 'm2', position: 1 }
];

function item(over: Partial<PendingChangeItem> = {}): PendingChangeItem {
  return {
    id: '01J000000000000000000000AA',
    projectId: 'p',
    productId: 'prod-1',
    productTitle: 'Mug',
    field: 'title',
    status: 'pending',
    approvedAtIso: '2026-08-30T10:00:00.000Z',
    error: null,
    retryable: true,
    detail: { kind: 'text', before: 'a', after: 'b' },
    ...over
  };
}

describe('toExcerpt', () => {
  it('flattens HTML, entities and whitespace into one line', () => {
    expect(toExcerpt('<p>Hand&nbsp;made   mug</p>\n<b>350 ml</b>')).toBe('Hand made mug 350 ml');
    expect(toExcerpt('Tom &amp; Jerry')).toBe('Tom & Jerry');
  });

  it('joins a tag array and drops non-strings', () => {
    expect(toExcerpt(['mug', 'kitchen'])).toBe('mug, kitchen');
    expect(toExcerpt(42)).toBeNull();
    expect(toExcerpt(null)).toBeNull();
  });

  it('is null on an empty value and truncates a long one', () => {
    expect(toExcerpt('   ')).toBeNull();
    expect(toExcerpt('<p> </p>')).toBeNull();
    const long = toExcerpt('x'.repeat(EXCERPT_MAX + 50));
    expect(long).toHaveLength(EXCERPT_MAX + 1);
    expect(long?.endsWith('…')).toBe(true);
    expect(toExcerpt('short', 10)).toBe('short');
  });
});

describe('buildPendingDetail', () => {
  it('gives a text field its before/after excerpts', () => {
    expect(buildPendingDetail('description', '<p>New</p>', '<p>Old</p>')).toEqual({
      kind: 'text',
      before: 'Old',
      after: 'New'
    });
    expect(buildPendingDetail('tags', ['a'], [])).toEqual({
      kind: 'text',
      before: null,
      after: 'a'
    });
  });

  it('keeps the ops of an images payload with the prior gallery refs', () => {
    const value = { v: 1, ops: [{ op: 'remove', target: 'm2' }] };
    expect(buildPendingDetail('images', value, PRIOR)).toEqual({
      kind: 'imageOps',
      ops: value.ops,
      prior: [
        { ref: 'm1', src: 'https://cdn.test/1.jpg' },
        { ref: 'm2', src: 'https://cdn.test/2.jpg' }
      ]
    });
  });

  it('counts both sides of the historical replace-all payload', () => {
    expect(
      buildPendingDetail('images', [{ src: 'https://cdn.test/a.jpg', alt: null }], PRIOR)
    ).toEqual({ kind: 'imageReplaceAll', before: 2, after: 1 });
    // An unusable value must not crash the modal — it reads as "replace by nothing".
    expect(buildPendingDetail('images', { v: 9 }, PRIOR)).toEqual({
      kind: 'imageReplaceAll',
      before: 2,
      after: 0
    });
  });

  it('falls back to positional refs when the store reported no image ids', () => {
    expect(priorImageRefs([{ src: 'a' }, { src: 'b' }])).toEqual([
      { ref: 'pos:0', src: 'a' },
      { ref: 'pos:1', src: 'b' }
    ]);
    expect(priorImageRefs('nope')).toEqual([]);
  });
});

describe('imageOpDescriptions', () => {
  it('names prior photos by their rank and anything else as a new photo', () => {
    const prior = priorImageRefs(PRIOR);
    expect(
      imageOpDescriptions(
        [
          { op: 'set_featured', target: 'm2' },
          { op: 'append', image: { src: 'https://cdn.test/gen.jpg', alt: null } },
          { op: 'replace', target: 'm1', image: { src: 'https://cdn.test/2.jpg', alt: null } },
          { op: 'reorder', order: ['m2', 'm1'] }
        ],
        prior,
        LABELS
      )
    ).toEqual([
      { key: 'opSetFeatured', values: { photo: 'Photo 2' } },
      { key: 'opAppend', values: { photo: 'a new photo' } },
      { key: 'opReplace', values: { photo: 'Photo 1', other: 'Photo 2' } },
      { key: 'opReorder', values: {} }
    ]);
  });
});

describe('counts, grouping and the result line', () => {
  it('counts by status and adds two counters', () => {
    const counts = countPending([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'conflict' },
      { status: 'failed' }
    ]);
    expect(counts).toEqual({ total: 4, pending: 2, conflict: 1, failed: 1 });
    expect(addCounts(counts, { total: 1, pending: 0, conflict: 1, failed: 0 })).toEqual({
      total: 5,
      pending: 2,
      conflict: 2,
      failed: 1
    });
  });

  it('drops a conflict or a failure that a newer change replaced', () => {
    const rows = [
      { id: '3', productId: 'p1', field: 'title', status: 'pending' as const },
      { id: '2', productId: 'p1', field: 'title', status: 'failed' as const },
      { id: '1', productId: 'p1', field: 'title', status: 'pending' as const },
      { id: '0', productId: 'p1', field: 'tags', status: 'conflict' as const },
      { id: '-1', productId: 'p2', field: 'title', status: 'failed' as const }
    ];
    expect(dropSuperseded(rows).map((r) => r.id)).toEqual(['3', '1', '0', '-1']);
  });

  it('groups rows by product, keeping the incoming order', () => {
    const groups = groupByProduct([
      item({ id: 'a', productId: 'p1', productTitle: 'Mug' }),
      item({ id: 'b', productId: 'p2', productTitle: 'Apron' }),
      item({ id: 'c', productId: 'p1', productTitle: 'Mug' })
    ]);
    expect(groups.map((g) => g.productId)).toEqual(['p1', 'p2']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(groups[1].productTitle).toBe('Apron');
    expect(groupByProduct([])).toEqual([]);
  });

  it('keeps only the non-zero parts of the outcome', () => {
    const labels = {
      queued: (n: number) => `${n} sent`,
      conflict: (n: number) => `${n} in conflict`,
      failed: (n: number) => `${n} failed`
    };
    expect(resultParts({ queued: 2, conflict: 1, failed: 0 }, labels)).toEqual([
      '2 sent',
      '1 in conflict'
    ]);
    expect(resultParts({ queued: 0, conflict: 0, failed: 0 }, labels)).toEqual([]);
  });
});
