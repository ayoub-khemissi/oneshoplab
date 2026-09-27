import { describe, expect, it } from 'vitest';
import { withoutTakenAppends } from '@/entities/product-change/client';

const A = 'https://cdn.test/a.png';
const B = 'https://cdn.test/b.png';

describe('withoutTakenAppends', () => {
  it('drops an append already on its way and renumbers the new: refs after it', () => {
    const out = withoutTakenAppends(
      {
        v: 1,
        ops: [
          { op: 'append', image: { src: A, alt: 'A' } },
          { op: 'append', image: { src: B, alt: null } },
          { op: 'set_alt', target: 'new:1', alt: 'B' },
          { op: 'reorder', order: ['new:1', 'm1', 'new:0'] }
        ]
      },
      new Set([A])
    );
    expect(out.dropped).toEqual([{ src: A, alt: 'A' }]);
    expect(out.payload).toEqual({
      v: 1,
      ops: [
        { op: 'append', image: { src: B, alt: null } },
        { op: 'set_alt', target: 'new:0', alt: 'B' },
        { op: 'reorder', order: ['new:0', 'm1'] }
      ]
    });
  });

  it('drops the ops aimed only at a dropped image, and leaves nothing when all is taken', () => {
    const out = withoutTakenAppends(
      {
        v: 1,
        ops: [
          { op: 'append', image: { src: A } },
          { op: 'set_alt', target: 'new:0', alt: 'x' },
          { op: 'reorder', order: ['new:0'] }
        ]
      },
      new Set([A])
    );
    expect(out.payload).toBeNull();
  });

  it('keeps replace and set_featured, which carry a placement', () => {
    const payload = {
      v: 1 as const,
      ops: [
        { op: 'replace' as const, target: 'm1', image: { src: A } },
        { op: 'set_featured' as const, image: { src: A } }
      ]
    };
    expect(withoutTakenAppends(payload, new Set([A])).payload).toEqual(payload);
  });
});
