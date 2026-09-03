import { describe, expect, it } from 'vitest';
import { appliedGeneratedSources } from '@/entities/product-change/lib/applied-images';

const CDN = 'https://cdn.oneshoplab.com/kie/a/1.png';

describe('appliedGeneratedSources', () => {
  it('counts a visual the store accepted', () => {
    const taken = appliedGeneratedSources([
      {
        field: 'images',
        status: 'applied',
        value: { v: 1, ops: [{ op: 'append', image: { src: CDN, alt: null } }] }
      }
    ]);
    expect(taken.has(CDN)).toBe(true);
  });

  it('ignores a change the store has not taken yet', () => {
    const pending = appliedGeneratedSources([
      {
        field: 'images',
        status: 'pending',
        value: { v: 1, ops: [{ op: 'append', image: { src: CDN, alt: null } }] }
      }
    ]);
    expect(pending.size).toBe(0);
  });

  it('ignores ops that put no new photo on the product', () => {
    const taken = appliedGeneratedSources([
      {
        field: 'images',
        status: 'applied',
        value: {
          v: 1,
          ops: [
            { op: 'set_alt', target: '11', alt: 'Un vase' },
            { op: 'remove', target: '22' },
            { op: 'reorder', order: ['11'] }
          ]
        }
      }
    ]);
    expect(taken.size).toBe(0);
  });

  it('reads the replace-all shape too', () => {
    const taken = appliedGeneratedSources([
      { field: 'images', status: 'applied', value: [{ src: CDN, alt: null }] }
    ]);
    expect(taken.has(CDN)).toBe(true);
  });

  it('leaves the other fields alone', () => {
    const taken = appliedGeneratedSources([
      { field: 'title', status: 'applied', value: 'Un titre' }
    ]);
    expect(taken.size).toBe(0);
  });

  it('takes a replace and a new featured photo as taken', () => {
    const other = 'https://cdn.oneshoplab.com/kie/a/2.png';
    const taken = appliedGeneratedSources([
      {
        field: 'images',
        status: 'applied',
        value: {
          v: 1,
          ops: [
            { op: 'replace', target: '11', image: { src: CDN, alt: null } },
            { op: 'set_featured', image: { src: other, alt: null } }
          ]
        }
      }
    ]);
    expect([...taken].sort()).toEqual([CDN, other].sort());
  });
});
